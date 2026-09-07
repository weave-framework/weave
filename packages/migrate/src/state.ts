import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a migration remembers between sittings.
 *
 * A large application is not migrated in one go. Without somewhere to keep them, every decision made on the
 * canvas dies with the browser tab, and the next run starts from nothing — which makes migrating in pieces,
 * the way anyone would actually do it, impossible.
 *
 * The file lives in the SOURCE project, beside the code the decisions are about, so it travels with the
 * repository: a colleague opening the same branch sees the same marks, and the history shows the migration
 * advancing. That is the one thing this tool writes there, it writes it only when a decision is made, and it
 * is a single readable JSON file anyone can delete.
 */

/** What has been decided about one node. */
export type Decision = 'migrate' | 'skip' | 'leave';

/** One thing already carried across, and where it landed. */
export interface Done {
  /** ISO timestamp, so the file reads as a log rather than a snapshot of unknown age. */
  at: string;
  /** The Weave project it was written into, relative to the source project when that is expressible. */
  to: string;
}

/** The file's shape. Everything is keyed by `GraphNode.key`, which is stable across machines. */
export interface MigrationState {
  /** Bumped only when the shape changes in a way an older reader could not handle. */
  version: 1;
  /** Which unit these decisions are about, relative to the source project root. Informational. */
  unit: string;
  /** Decisions still to be acted on. */
  decisions: Record<string, Decision>;
  /** What has already been carried across. Kept apart from decisions: one is intent, the other is history. */
  done: Record<string, Done>;
}

/** The file's name. Singular and dotted, so it sorts with the other project-level dotfiles. */
export const STATE_FILE: string = '.weave-migrate.json';

/** An empty state, so a caller never has to handle "no file yet" as a special case. */
export function emptyState(unit: string): MigrationState {
  return { version: 1, unit, decisions: {}, done: {} };
}

/**
 * Read the state for a unit, or an empty one.
 *
 * A file that is missing, unreadable, or holds something other than what this expects yields the empty state
 * rather than an error. Losing marks is bad; refusing to open the application because a hand-edited file has
 * a stray comma is worse, and the marks are recoverable by making them again.
 */
export function readState(unitDir: string): MigrationState {
  const path: string = join(unitDir, STATE_FILE);
  if (!existsSync(path)) return emptyState('');
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyState('');
    const asState: Partial<MigrationState> = raw as Partial<MigrationState>;
    return {
      version: 1,
      unit: typeof asState.unit === 'string' ? asState.unit : '',
      decisions: pickDecisions(asState.decisions),
      done: pickDone(asState.done),
    };
  } catch {
    return emptyState('');
  }
}

/**
 * Write the state for a unit, and answer where it went.
 *
 * Sorted keys and a trailing newline, because this file is committed: an unordered object would produce a diff
 * every time anything moved, and reviewing "12 lines changed" that are the same 12 marks in another order
 * teaches a reader to stop reading the diff.
 */
export function writeState(unitDir: string, state: MigrationState): string {
  const path: string = join(unitDir, STATE_FILE);
  const ordered: MigrationState = {
    version: 1,
    unit: state.unit,
    decisions: sortKeys(state.decisions),
    done: sortKeys(state.done),
  };
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  return path;
}

/** Keep only entries whose value is a decision this version understands. */
function pickDecisions(input: unknown): Record<string, Decision> {
  const out: Record<string, Decision> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === 'migrate' || value === 'skip' || value === 'leave') out[key] = value;
  }
  return out;
}

/** Keep only entries that carry both fields; a half-written record says nothing useful. */
function pickDone(input: unknown): Record<string, Done> {
  const out: Record<string, Done> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry: Partial<Done> = value as Partial<Done>;
    if (typeof entry.at === 'string' && typeof entry.to === 'string') out[key] = { at: entry.at, to: entry.to };
  }
  return out;
}

/** A new object with the same entries in key order. */
function sortKeys<T>(input: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(input).sort()) out[key] = input[key];
  return out;
}
