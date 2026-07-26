/**
 * `weave migrate` — verify the ASSEMBLED output, before a byte is written.
 *
 * Every other check in this tool looks at one declaration at a time: the converter walks components, then
 * services, then pipes, each in isolation, and the writer puts bytes on disk. Nothing ever looked at the RESULT
 * as a whole — so a rename that landed in one file and not in its importer, an import repointed to a name the
 * converted file no longer exports, or two sources arriving at one output path, all shipped silently and turned
 * up later as "you migrated one place and left rubbish in another".
 *
 * This type-checks the planned files TOGETHER, in memory, resolving against the target app's real
 * `node_modules`. The result is not a compiler's opinion about style; it is the answer to one question the
 * per-file pipeline cannot ask: does what we are about to write hold together?
 *
 * The two causes are told apart, because only one of them is the tool's fault:
 *   • `missing-dependency` — a module the target app does not have. That is a `pnpm add` away, and the
 *     conversion is not wrong for naming it.
 *   • `defect` — anything else. The converted code contradicts itself, and that IS the tool's fault.
 */
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { WriteItem } from './migrate-convert.js';

/** One thing wrong with the output, located. */
export interface OutputProblem {
  /** Path relative to the target app — what the user would open. */
  file: string;
  /** 1-based line, or 0 when the diagnostic has no position (a whole-file error). */
  line: number;
  message: string;
  /** A module the app lacks is not the same failure as code that contradicts itself. */
  kind: 'missing-dependency' | 'defect';
  /** The unresolved specifier, when `kind` is `missing-dependency`. */
  module?: string;
}

/** Compare paths the way a compiler host must: one separator, one case on Windows. */
function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * A compiler host that serves the PLANNED files from memory and everything else from disk. The planned files sit
 * at their real target paths, so relative imports between them resolve exactly as they will once written, and
 * `node_modules` resolution finds the app's actual dependencies rather than this CLI's.
 */
function hostOver(planned: Map<string, string>, options: ts.CompilerOptions): ts.CompilerHost {
  const base: ts.CompilerHost = ts.createCompilerHost(options, true);
  const readPlanned = (p: string): string | undefined => planned.get(norm(p));
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (p: string): boolean => readPlanned(p) !== undefined || base.fileExists(p),
    readFile: (p: string): string | undefined => readPlanned(p) ?? base.readFile(p),
    getSourceFile: (p: string, lang: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (m: string) => void, shouldCreate?: boolean): ts.SourceFile | undefined => {
      const text: string | undefined = readPlanned(p);
      if (text === undefined) return base.getSourceFile(p, lang, onError, shouldCreate);
      return ts.createSourceFile(p, text, lang, true);
    },
    // Module resolution asks whether a DIRECTORY exists before it probes for files in it — and the planned
    // files live in folders that are not on disk yet, so every relative import between them failed to resolve
    // for a file the very same check was about to write.
    directoryExists: (dir: string): boolean => {
      const d: string = `${norm(dir).replace(/\/$/, '')}/`;
      for (const p of planned.keys()) if (p.startsWith(d)) return true;
      return base.directoryExists?.(dir) ?? false;
    },
    writeFile: (): void => {
      /* noEmit — the point is the diagnostics, and nothing may touch disk before the user says yes */
    },
  };
  // `createCompilerHost` ships its OWN module resolver, closed over its OWN `fileExists`. Spreading the host
  // carries that resolver along, so it never sees the planned files: `./a` next to `./b` reported "Cannot find
  // module" for a file the very same check was about to write. Resolution has to run through THIS host.
  host.resolveModuleNameLiterals = (
    literals: readonly ts.StringLiteralLike[],
    containingFile: string,
    redirected: ts.ResolvedProjectReference | undefined,
    opts: ts.CompilerOptions,
  ): readonly ts.ResolvedModuleWithFailedLookupLocations[] =>
    literals.map((lit) => ts.resolveModuleName(lit.text, containingFile, opts, host, undefined, redirected));
  delete host.getModuleResolutionCache; // a cache built against the other host would answer the same way
  return host;
}

/**
 * Type-check the planned `.ts` files together. Returns every problem IN THOSE FILES — a diagnostic inside
 * `node_modules` or a lib file is the toolchain's business, not this migration's.
 *
 * `targetDir` is the Weave app being migrated into: resolution starts there, so `@weave-framework/*` and the
 * app's own dependencies resolve to what the app actually has installed.
 */
export function verifyOutput(items: WriteItem[], targetDir: string): OutputProblem[] {
  const planned: Map<string, string> = new Map<string, string>();
  for (const it of items) {
    if (it.status !== 'write' || !/\.tsx?$/.test(it.path)) continue;
    planned.set(norm(it.path), it.content);
  }
  if (!planned.size) return [];

  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    // The app's own `types` are its business; pulling ambient packages in here only invents errors.
    types: [],
    // Resolution runs from the target app, so its node_modules is what gets found.
    baseUrl: targetDir,
  };
  const roots: string[] = [...planned.keys()];
  let program: ts.Program;
  try {
    program = ts.createProgram(roots, options, hostOver(planned, options));
  } catch {
    return []; // a broken toolchain is not a finding ABOUT THE OUTPUT — say nothing rather than something false
  }

  const out: OutputProblem[] = [];
  for (const d of [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()]) {
    const file: ts.SourceFile | undefined = d.file;
    if (!file || !planned.has(norm(file.fileName))) continue;
    const message: string = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    // 2307 is "Cannot find module 'x'": the app does not have it. That is an install, not a defect.
    const missing: RegExpMatchArray | null = d.code === 2307 ? message.match(/Cannot find module '([^']+)'/) : null;
    out.push({
      file: relative(targetDir, file.fileName),
      line: d.start === undefined ? 0 : file.getLineAndCharacterOfPosition(d.start).line + 1,
      message,
      kind: missing ? 'missing-dependency' : 'defect',
      ...(missing ? { module: missing[1] } : {}),
    });
  }
  // Most-broken file first: a file with twenty errors is where the reader should look, not the one with one.
  const perFile: Map<string, number> = new Map<string, number>();
  for (const p of out) perFile.set(p.file, (perFile.get(p.file) ?? 0) + 1);
  return out.sort((a, b) => (perFile.get(b.file) ?? 0) - (perFile.get(a.file) ?? 0) || a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Two planned files landing on ONE path. `applyWrites` writes in order, so the second silently replaces the
 * first — the migration reports both as written and one of them is not there. A collision is not a diagnostic
 * about code; it is an accounting error, and it is checked without a compiler.
 */
export function collisions(items: WriteItem[]): Array<{ path: string; count: number }> {
  const seen: Map<string, number> = new Map<string, number>();
  for (const it of items) seen.set(it.path, (seen.get(it.path) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([path, count]) => ({ path, count }));
}

/** `node_modules` next to the target app, if the app has one — used only to say whether a check can be trusted. */
export function hasInstalledDeps(targetDir: string): boolean {
  let dir: string = targetDir;
  for (let up: number = 0; up < 5; up++) {
    if (existsSync(join(dir, 'node_modules'))) return true;
    const parent: string = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/** Read a file if it is there — a small helper so callers need no try/catch. @internal */
export function tryRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
