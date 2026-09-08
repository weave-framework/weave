import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  carriedPackages,
  detectPackageManager,
  installCommand,
  installedWeavePackages,
  planWrites,
  requiredWeavePackages,
  type WriteItem,
  type WriteLayout,
} from '../../cli/src/migrate-convert.js';
import type { MigrationFacts } from './analyze.js';
import type { Graph, GraphNode } from './types.js';
import { createLibraries, librariesFor, shapeOf, type LibraryResult, type NeededLibrary, type TargetShape } from './workspace.js';

/**
 * Turning marks into files.
 *
 * Everything before this reads. This is the only part of the service that creates anything, and it creates it
 * in the project the service was STARTED FROM — never in the application being read, which stays read-only
 * however this is called.
 *
 * The converter itself already knew how to do all of it: `planWrites` drafts every file, `requiredWeavePackages`
 * says what the output needs installed, `carriedPackages` says what it still imports. The terminal command has
 * used them since M4. The web UI simply never called them, which is why its third step ended in three lists and
 * a reader asking what to do with them.
 *
 * The one thing added here is PARTIAL writes. `planWrites` converts a whole unit, and the point of marking
 * cards is to migrate an application in pieces — so an item is kept only when the file it was converted from
 * is one the reader asked for. That is what `WriteItem.source` exists for.
 */

/** One planned file, as the screen needs it — the content stays on the server. */
export interface PlannedFile {
  /** Relative to the target project, so the screen shows a path a person recognises. */
  path: string;
  status: 'write' | 'skip-exists';
  /** The source file it came from, relative to the analysed unit. Absent for the unit-wide files. */
  from?: string;
}

/** What would happen if the reader said yes. */
export interface WritePlan {
  /** Where it all lands, relative to the target project. */
  outRoot: string;
  files: PlannedFile[];
  /** How many would actually be created — the rest already exist and are never touched. */
  fresh: number;
  /** Weave packages the generated code imports that the target project does not have. */
  missing: string[];
  /** The install line for THIS project's package manager, or empty when nothing is missing. */
  install: string;
  /** Third-party packages the written code still imports — dependencies this migration hands the app. */
  carried: string[];
  /** Marked things whose files nothing planned — named rather than silently dropped. */
  unplanned: string[];
  /** What the target is: an Nx workspace, or one application. */
  shape: TargetShape;
  /** Source libraries the target must have before these files can resolve each other. */
  libraries: NeededLibrary[];
}

/**
 * Plan the files for a set of marked nodes.
 *
 * `keys` is what the page decided, closure included: the screen already works out what a mark drags in, and
 * that logic is gated where it lives. Repeating it here would give two answers to one question, and the one
 * the reader saw would not be the one that wrote the files.
 */
export function planFor(facts: MigrationFacts, graph: Graph, targetDir: string, subdir: string, keys: string[], layout: WriteLayout = 'flat'): WritePlan {
  const wanted: Set<string> = new Set<string>(keys);
  /* A marked node names its source relative to the unit; a planned item names it absolutely. Comparing them
     needs one shape, and the relative one is the only one both have. */
  const sources: Set<string> = new Set<string>();
  const unplanned: string[] = [];
  for (const node of graph.nodes) {
    if (!wanted.has(node.key)) continue;
    if (node.file) sources.add(norm(node.file));
    else unplanned.push(node.label);
  }

  const all: WriteItem[] = planWrites(facts, targetDir, subdir, layout);
  const mine: WriteItem[] = all.filter((item: WriteItem): boolean => {
    // The unit-wide files — the contexts module, the guards — belong to whatever is written, not to one card.
    if (!item.source) return true;
    const from: string = norm(item.source);
    for (const src of sources) if (from.endsWith(src)) return true;
    return false;
  });

  // In a workspace the projects live at the root, not under the app's `src/`.
  const shape: TargetShape = shapeOf(targetDir);
  const outRoot: string = layout === 'workspace' ? subdir || '.' : join('src', subdir);
  const files: PlannedFile[] = mine.map(
    (item: WriteItem): PlannedFile => ({
      path: norm(relative(targetDir, item.path)),
      status: item.status,
      ...(item.source ? { from: norm(item.source) } : {}),
    }),
  );
  const missing: string[] = requiredWeavePackages(mine).filter((p: string): boolean => !installedWeavePackages(targetDir).includes(p));
  return {
    outRoot: norm(outRoot),
    files,
    fresh: files.filter((f: PlannedFile): boolean => f.status === 'write').length,
    missing,
    install: missing.length ? installCommand(detectPackageManager(targetDir), missing) : '',
    carried: carriedPackages(mine),
    unplanned,
    shape,
    libraries: shape === 'nx' ? librariesFor(facts, [...sourceFilesOf(mine)], subdir) : [],
  };
}

/** What one write actually did, so the page can record it rather than assume it. */
export interface Written {
  path: string;
  from?: string;
}

/**
 * Write the planned files, skipping anything already there.
 *
 * A file that exists is never touched, and that is not a detail: the target is the reader's own project, and a
 * migration that overwrote hand-edited code would destroy work that no undo in this tool could bring back.
 * `planWrites` marks those `skip-exists`; this refuses them a second time, because the plan may have been made
 * a while ago and the check is one line.
 */
/** What a write run did, including the libraries it had to create first. */
export interface WriteResult {
  written: Written[];
  /** Empty for a single-project target; one entry per library on an Nx one. */
  libraries: LibraryResult[];
}

/**
 * Create the libraries, then write the files.
 *
 * In that order and not the other way round: a converted file imports `@sps-services/auth`, and until a project
 * answers to that name the code that lands does not resolve. On a single-project target there are no libraries
 * to make and this is just the write.
 */
export function convert(facts: MigrationFacts, graph: Graph, targetDir: string, subdir: string, keys: string[]): WriteResult {
  const shape: TargetShape = shapeOf(targetDir);
  const layout: WriteLayout = shape === 'nx' ? 'workspace' : 'flat';
  const libraries: LibraryResult[] =
    shape === 'nx' ? createLibraries(targetDir, planFor(facts, graph, targetDir, subdir, keys, layout).libraries) : [];
  return { written: writePlanned(facts, graph, targetDir, subdir, keys, layout), libraries };
}

export function writePlanned(facts: MigrationFacts, graph: Graph, targetDir: string, subdir: string, keys: string[], layout: WriteLayout = 'flat'): Written[] {
  const wanted: Set<string> = new Set<string>(keys);
  const sources: Set<string> = new Set<string>();
  for (const node of graph.nodes) if (wanted.has(node.key) && node.file) sources.add(norm(node.file));

  const done: Written[] = [];
  for (const item of planWrites(facts, targetDir, subdir, layout)) {
    if (item.source) {
      const from: string = norm(item.source);
      let mine: boolean = false;
      for (const src of sources) if (from.endsWith(src)) mine = true;
      if (!mine) continue;
    }
    if (item.status === 'skip-exists' || existsSync(item.path)) continue;
    mkdirSync(dirname(item.path), { recursive: true });
    writeFileSync(item.path, item.content, 'utf8');
    done.push({ path: norm(relative(targetDir, item.path)), ...(item.source ? { from: norm(item.source) } : {}) });
  }
  return done;
}

/** The absolute source files behind a set of planned writes. */
function sourceFilesOf(items: WriteItem[]): Set<string> {
  const out: Set<string> = new Set<string>();
  for (const item of items) if (item.source) out.add(item.source);
  return out;
}

/** One separator, so a Windows path and a posix one compare as the same path. */
function norm(path: string): string {
  return path.split(sep).join('/').split('\\').join('/');
}

/** Every node the graph knows, by key — so a caller can say what a key stood for. */
export function nodesByKey(graph: Graph): Map<string, GraphNode> {
  return new Map<string, GraphNode>(graph.nodes.map((n: GraphNode): [string, GraphNode] => [n.key, n]));
}
