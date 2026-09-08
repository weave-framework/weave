import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { findWorkspaceRoot, type MigrationFacts } from './analyze.js';

/**
 * Recreating a source workspace's libraries in the target.
 *
 * Raised by the reader: "the migration should keep the same structure — for a single project it is obviously
 * the app plus its services and you just add the tsconfig paths, but what about Nx? You have to follow the Nx
 * commands." Both halves are right, and the second is not a preference. Measured on one real Angular workspace,
 * the converted output held 24 imports naming 12 source libraries — `@sps-services/auth`, `@sps-components/
 * breadcrumbs` and the rest — and flat output answers to none of those names, because the boundary that gave
 * them their names is gone. The code does not compile until the libraries exist again.
 *
 * So for an Nx target we run the reader's own Nx. `nx g @weave-framework/nx:library` writes `project.json`, the
 * `tsconfig.base.json` import path and the package deps the way Nx means them to be written; reimplementing
 * that here would be a second, drifting copy of somebody else's conventions.
 */

/** What the target project is, which decides where converted libraries go. */
export type TargetShape =
  /** An Nx workspace: `nx.json` at the root. Libraries become projects. */
  | 'nx'
  /** One application. Everything lands in its `src/`. */
  | 'single';

/** One source library that has to exist in the target before its files can be written. */
export interface NeededLibrary {
  /** The Nx project name — the source folder's name. */
  name: string;
  /** Where the project goes, relative to the target root (`services`). */
  directory: string;
  /** What other code imports it by. Kept from the SOURCE, so the converted imports resolve unchanged. */
  importPath: string;
  /** The source folder it came from, for reporting. */
  from: string;
}

/** Whether the target is an Nx workspace. `nx.json` is the marker Nx itself uses. */
export function shapeOf(targetDir: string): TargetShape {
  return existsSync(join(targetDir, 'nx.json')) ? 'nx' : 'single';
}

/**
 * The libraries a set of source files needs, keyed by the specifier the converted code already imports.
 *
 * The import path is taken from the SOURCE workspace's own tsconfig rather than invented. That is the whole
 * trick: recreate `@sps-services/auth` under that name and the 24 broken imports resolve with nothing rewritten.
 * A library the source has no alias for gets no entry — inventing a name would produce imports that match
 * nothing, which is the state this exists to leave.
 */
export function librariesFor(facts: MigrationFacts, sourceFiles: string[], subdir: string): NeededLibrary[] {
  const aliases: Map<string, string> = sourceAliases(facts);
  const out: Map<string, NeededLibrary> = new Map<string, NeededLibrary>();
  for (const unit of facts.granted ?? []) {
    // The analysed application is not a library, whatever else is true of it.
    if (!relative(facts.unit, unit).startsWith('..') && !relative(unit, facts.unit).startsWith('..')) continue;
    if (!sourceFiles.some((f: string): boolean => !relative(unit, f).startsWith('..'))) continue;
    const importPath: string | undefined = aliases.get(norm(unit));
    if (!importPath) continue;
    const name: string = basename(unit);
    out.set(importPath, { name, directory: subdir || '', importPath, from: unit });
  }
  return [...out.values()].sort((a: NeededLibrary, b: NeededLibrary): number => a.importPath.localeCompare(b.importPath));
}

/**
 * The source workspace's own `alias -> library folder` table.
 *
 * Read from `tsconfig.base.json` beside the workspace root, which is where Nx keeps it. Comments are stripped
 * before parsing: a hand-maintained base tsconfig very often has them, and `JSON.parse` refuses the whole file
 * over one, which would silently produce "no aliases" and no libraries at all.
 */
export function sourceAliases(facts: MigrationFacts): Map<string, string> {
  const out: Map<string, string> = new Map<string, string>();
  const root: string = findWorkspaceRoot(facts.unit);
  // Walked from the analysed unit rather than carried on the facts: the unit is what the reader pointed
  // at, and the same walk is what found the aliases in the first place.
  for (const name of ['tsconfig.base.json', 'tsconfig.json']) {
    const file: string = join(root, name);
    if (!existsSync(file)) continue;
    try {
      const text: string = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const json: { compilerOptions?: { paths?: Record<string, string[]> } } = JSON.parse(text) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      for (const [alias, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const first: string | undefined = targets[0];
        if (!first || alias.includes('*')) continue;
        // `services/auth/src/index.ts` is the library `services/auth`; `app/src/modules/one/index.ts` is the
        // folder it sits in. Splitting on the FIRST `/src/` collapsed both of those onto `app`, so two
        // distinct aliases claimed one directory and the second quietly replaced the first.
        const barrel: string = first.replace(/^\.?\//, '');
        const dir: string = /\/src\/index\.tsx?$/.test(barrel)
          ? barrel.replace(/\/src\/index\.tsx?$/, '')
          : barrel.replace(/\/[^/]+$/, '');
        out.set(norm(join(root, dir)), alias);
      }
      break;
    } catch {
      // A base tsconfig we cannot read yields no aliases, and the caller reports that rather than guessing.
    }
  }
  return out;
}

/** What one attempt to create a library did. */
export interface LibraryResult {
  library: NeededLibrary;
  created: boolean;
  /**
   * Whether the library is THERE, which is not the same as whether this run made it.
   *
   * One that already existed is not created and is perfectly usable; one that failed is neither. Collapsing
   * the two is how 247 files came to be written into 51 folders that no `project.json` and no tsconfig path
   * referred to — a state strictly worse than not having run at all.
   */
  usable: boolean;
  /** Why not, when it was not. Shown to the reader rather than swallowed. */
  note: string;
}

/**
 * Create the libraries by running the target's own Nx.
 *
 * `--empty` because the generator's starter component is boilerplate in every one of these: the library is
 * about to be filled with converted code, and a reader migrating twelve of them would have twelve stubs to
 * find and delete. A library that already exists is left exactly as it is.
 *
 * Failures are returned, never thrown. Nx not being installed, or the Weave plugin missing, is a thing to tell
 * the reader about — not a reason for the whole migration to stop with a stack trace.
 */
export function createLibraries(targetDir: string, libs: NeededLibrary[]): LibraryResult[] {
  const results: LibraryResult[] = [];
  for (const library of libs) {
    if (existsSync(join(targetDir, library.directory, library.name, 'project.json'))) {
      results.push({ library, created: false, usable: true, note: 'already a project here — left as it is' });
      continue;
    }
    const args: string[] = [
      'nx',
      'g',
      '@weave-framework/nx:library',
      library.name,
      `--directory=${library.directory || '.'}`,
      `--importPath=${library.importPath}`,
      '--empty',
      '--style=none',
      '--no-interactive',
    ];
    try {
      execFileSync('npx', args, { cwd: targetDir, stdio: 'pipe', timeout: 120_000, shell: process.platform === 'win32' });
      results.push({ library, created: true, usable: true, note: '' });
    } catch (error: unknown) {
      const why: string = error instanceof Error ? error.message.split('\n')[0] : String(error);
      results.push({ library, created: false, usable: false, note: why });
    }
  }
  return results;
}

/** One separator, so a Windows path and a posix one compare as the same path. */
function norm(path: string): string {
  return path.split(sep).join('/').toLowerCase().replace(/\/+$/, '');
}
