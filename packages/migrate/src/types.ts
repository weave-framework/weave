/**
 * The shapes the service and the UI agree on — and nothing else.
 *
 * This file exists because the browser half imports these types from the Node half, and every module that
 * touches `node:fs` drags the whole Node type surface with it into a project that has none. Keeping the contract
 * in one dependency-free file means the UI can name what it receives without pretending to be a server, and both
 * sides break at the same moment when a field changes.
 */

/** Project kinds a workspace can declare. `null` means no file said. */
export type UnitType = 'application' | 'library' | null;

/** Which file declared a unit — shown in the UI so the reader knows where the name and type came from. */
export type DeclaredBy = 'angular.json' | 'project.json' | 'package.json';

/** One migratable project: an application or a library. A service or component lives inside one. */
export interface Unit {
  /** The project's declared name, or its folder name when nothing declares one. */
  name: string;
  /** Absolute path to the project root. */
  root: string;
  /** What the workspace says this is. `null` when unstated — never guessed. */
  type: UnitType;
  /** The file this unit was read from. */
  declaredBy: DeclaredBy;
}

/** A workspace marker at the root: present or not. Both halves matter — an absence is information too. */
export interface Signal {
  /** The file or folder looked for, exactly as it appears on disk. */
  file: string;
  found: boolean;
}

/** Everything the first screen needs about a source repository. */
export interface Workspace {
  /** Absolute path that was inspected. */
  root: string;
  /** Every marker looked for, in a fixed order, found or not. */
  signals: Signal[];
  /** The migratable projects found inside, sorted by path. */
  units: Unit[];
  /** How deep the directory walk went — the UI says this, because a deeper project is not reported. */
  scannedDepth: number;
}

/** One folder in a listing. */
export interface Entry {
  name: string;
  path: string;
  /** The marker files this folder holds — the reason to go in, or not. */
  markers: string[];
}

/** A folder's contents, plus where to go from here. */
export interface Listing {
  /** The folder listed, or `''` for the roots listing. */
  path: string;
  /** The parent, or null at a filesystem root. */
  parent: string | null;
  /** Sub-folders, alphabetical. Files are not listed — a migration target is always a folder. */
  entries: Entry[];
  /** Handy starting points, sent with every listing so the UI never has to guess them. */
  shortcuts: Entry[];
}

/** A quick look at one path — enough to say whether scanning it is worth the wait. */
export interface Peek {
  /** The path, resolved. */
  path: string;
  exists: boolean;
  /** False for a file: a migration target is always a folder. */
  directory: boolean;
  /** The marker files it carries — the same ones the picker shows beside a folder. */
  markers: string[];
}
