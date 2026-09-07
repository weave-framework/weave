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
} from '../../cli/src/migrate-convert.js';
import type { MigrationFacts } from './analyze.js';
import type { Graph, GraphNode } from './types.js';

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
}

/**
 * Plan the files for a set of marked nodes.
 *
 * `keys` is what the page decided, closure included: the screen already works out what a mark drags in, and
 * that logic is gated where it lives. Repeating it here would give two answers to one question, and the one
 * the reader saw would not be the one that wrote the files.
 */
export function planFor(facts: MigrationFacts, graph: Graph, targetDir: string, subdir: string, keys: string[]): WritePlan {
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

  const all: WriteItem[] = planWrites(facts, targetDir, subdir);
  const mine: WriteItem[] = all.filter((item: WriteItem): boolean => {
    // The unit-wide files — the contexts module, the guards — belong to whatever is written, not to one card.
    if (!item.source) return true;
    const from: string = norm(item.source);
    for (const src of sources) if (from.endsWith(src)) return true;
    return false;
  });

  const outRoot: string = join('src', subdir);
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
export function writePlanned(facts: MigrationFacts, graph: Graph, targetDir: string, subdir: string, keys: string[]): Written[] {
  const wanted: Set<string> = new Set<string>(keys);
  const sources: Set<string> = new Set<string>();
  for (const node of graph.nodes) if (wanted.has(node.key) && node.file) sources.add(norm(node.file));

  const done: Written[] = [];
  for (const item of planWrites(facts, targetDir, subdir)) {
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

/** One separator, so a Windows path and a posix one compare as the same path. */
function norm(path: string): string {
  return path.split(sep).join('/').split('\\').join('/');
}

/** Every node the graph knows, by key — so a caller can say what a key stood for. */
export function nodesByKey(graph: Graph): Map<string, GraphNode> {
  return new Map<string, GraphNode>(graph.nodes.map((n: GraphNode): [string, GraphNode] => [n.key, n]));
}
