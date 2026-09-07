import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * What a migration remembers between sittings.
 *
 * A large application is not migrated in one go. Without somewhere to keep them, every decision made on the
 * canvas dies with the browser tab, and the next run starts from nothing — which makes migrating in pieces,
 * the way anyone would actually do it, impossible.
 *
 * The file lives where the migration was STARTED FROM: the working directory, which is the project being
 * migrated INTO. The source application is read and never written to. It is a working repository, quite
 * possibly somebody else's, and a tool that reads it has no business leaving files in it — the first version
 * of this put the plan beside the source, and that was the objection, correctly raised.
 *
 * One file holds plans for several sources, because one Weave project may take pieces from more than one
 * Angular application. They are keyed by the source's folder name, not its path: the path is one person's
 * disk, and this file is committed.
 */

/** What has been decided about one node. Marked or not; not being marked is not a decision. */
export type Decision = 'migrate';

/** One thing already carried across, and where it landed. */
export interface Done {
  /** ISO timestamp, so the file reads as a log rather than a snapshot of unknown age. */
  at: string;
  /** Where it was written, relative to this file when that is expressible. */
  to: string;
}

/** The plan for one source application. */
export interface SourcePlan {
  /** Where it was read from when these marks were made. Informational: another machine will differ. */
  source: string;
  /** Marks still to be acted on, keyed by `GraphNode.key`. */
  decisions: Record<string, Decision>;
  /** What has already been carried across. Apart from decisions: one is intent, the other is history. */
  done: Record<string, Done>;
}

/** The file's shape. */
export interface MigrationState {
  /** Bumped only when the shape changes in a way an older reader could not handle. */
  version: 2;
  /** Plans, by the source's folder name. */
  sources: Record<string, SourcePlan>;
}

/** The file's name, in the project being migrated into. */
export const STATE_FILE: string = '.weave-migrate.json';

/** The key a source is filed under: its folder name, which survives being read on another machine. */
export function sourceKey(sourceDir: string): string {
  return basename(sourceDir.replace(/[\\/]+$/, '')) || sourceDir;
}

/** An empty state, so a caller never has to handle "no file yet" as a special case. */
export function emptyState(): MigrationState {
  return { version: 2, sources: {} };
}

/** An empty plan for one source. */
export function emptyPlan(sourceDir: string): SourcePlan {
  return { source: sourceDir, decisions: {}, done: {} };
}

/**
 * Read the whole file from the project being migrated into, or an empty state.
 *
 * A file that is missing, unreadable, or holds something other than what this expects yields an empty state
 * rather than an error. Losing marks is bad; refusing to open the application because a hand-edited file has a
 * stray comma is worse, and the marks can be made again.
 */
export function readState(intoDir: string): MigrationState {
  const path: string = join(intoDir, STATE_FILE);
  if (!existsSync(path)) return emptyState();
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyState();
    const asState: { sources?: unknown } = raw as { sources?: unknown };
    const out: MigrationState = emptyState();
    if (asState.sources && typeof asState.sources === 'object') {
      for (const [key, value] of Object.entries(asState.sources as Record<string, unknown>)) {
        out.sources[key] = readPlan(value);
      }
    }
    return out;
  } catch {
    return emptyState();
  }
}

/** The plan for one source, filtered to what this version understands. */
export function readPlan(input: unknown): SourcePlan {
  const out: SourcePlan = { source: '', decisions: {}, done: {} };
  if (!input || typeof input !== 'object') return out;
  const asPlan: { source?: unknown; decisions?: unknown; done?: unknown } = input as {
    source?: unknown;
    decisions?: unknown;
    done?: unknown;
  };
  if (typeof asPlan.source === 'string') out.source = asPlan.source;
  if (asPlan.decisions && typeof asPlan.decisions === 'object') {
    for (const [key, value] of Object.entries(asPlan.decisions as Record<string, unknown>)) {
      if (value === 'migrate') out.decisions[key] = value;
    }
  }
  if (asPlan.done && typeof asPlan.done === 'object') {
    for (const [key, value] of Object.entries(asPlan.done as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry: { at?: unknown; to?: unknown } = value as { at?: unknown; to?: unknown };
      if (typeof entry.at === 'string' && typeof entry.to === 'string') out.done[key] = { at: entry.at, to: entry.to };
    }
  }
  return out;
}

/**
 * Replace the plan for one source and write the file back, answering where it went.
 *
 * Sorted keys and a trailing newline, because this file is committed: an unordered object would produce a diff
 * every time anything moved, and reviewing "12 lines changed" that are the same 12 marks in another order
 * teaches a reader to stop reading the diff. Plans for other sources are left exactly as they were.
 */
export function writePlan(intoDir: string, sourceDir: string, plan: SourcePlan): string {
  const path: string = join(intoDir, STATE_FILE);
  const state: MigrationState = readState(intoDir);
  state.sources[sourceKey(sourceDir)] = { ...plan, source: sourceDir };
  const ordered: MigrationState = { version: 2, sources: {} };
  for (const key of Object.keys(state.sources).sort()) {
    const p: SourcePlan = state.sources[key];
    ordered.sources[key] = { source: p.source, decisions: sortKeys(p.decisions), done: sortKeys(p.done) };
  }
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  return path;
}

/** A new object with the same entries in key order. */
function sortKeys<T>(input: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(input).sort()) out[key] = input[key];
  return out;
}
