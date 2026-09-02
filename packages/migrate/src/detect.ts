/**
 * Workspace detection for `weave migrate` — what kind of repository is this, and what is inside it.
 *
 * This exists because the first screen of the migration UI reports rather than asks: the user gives a path, and
 * the tool says what it found. That only works if "what it found" is complete, so this module answers two
 * separate questions and never conflates them:
 *
 *  1. **Signals** — which workspace markers exist at the root. Reported as found/not-found, never collapsed into
 *     a single verdict like "this is an Nx monorepo", because the markers overlap: an Nx workspace commonly
 *     carries `nx.json` AND `angular.json`, and a pnpm one carries neither.
 *  2. **Units** — the migratable projects, each with the name and type its own workspace declares.
 *
 * A unit's `type` is `null` when nothing declares it. Nx's own schema (`node_modules/nx/schemas/project-schema.json`)
 * has no `required` list at all, so `projectType` is optional and its enum is exactly `["library", "application"]` —
 * there is no third value to infer and no default to fall back on. Recording the absence is the honest answer;
 * guessing `application` would be right most of the time and silently wrong the rest.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

/** How deep to walk looking for units. A found unit is a leaf; the walk does not descend into it. */
export const MAX_DEPTH: number = 5;

/**
 * The markers, in the order the UI shows them. `apps` is a folder, the rest are files — both are just
 * "does this path exist", so one list covers them.
 */
const MARKERS: string[] = ['nx.json', 'angular.json', 'pnpm-workspace.yaml', 'package.json', 'apps'];

/** Read the workspace markers at `dir`. Every marker is reported, found or not. */
export function readSignals(dir: string): Signal[] {
  return MARKERS.map((file: string): Signal => ({ file, found: existsSync(join(dir, file)) }));
}

/** Parse a JSON file, returning null rather than throwing — a malformed file is not a signal. */
function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Does this `package.json` shape depend on any `@angular/*` package? */
function dependsOnAngular(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null): boolean {
  if (!pkg) return false;
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(deps).some((d: string): boolean => d.startsWith('@angular/'));
}

/**
 * An Nx `project.json` that is an Angular unit — an application OR a library. Both migrate: a service lives in a
 * library as readily as in an app. Matched on any `@angular` reference anywhere in the file, because the marker
 * moved between Nx versions (`@angular-devkit`, `@nx/angular`) and the exact target name is not the point.
 */
function projectJsonUnit(dir: string): Unit | null {
  const file: string = join(dir, 'project.json');
  const raw: { name?: string; projectType?: string } | null = readJson(file);
  if (!raw) return null;
  const text: string = JSON.stringify(raw);
  if (!text.includes('@angular-devkit') && !text.includes('@nx/angular') && !text.includes('@angular/')) return null;
  return {
    name: raw.name ?? basename(dir),
    root: dir,
    type: asUnitType(raw.projectType),
    declaredBy: 'project.json',
  };
}

/**
 * A workspace member declared only by its own `package.json` — no `project.json` at all. Nx identifies projects
 * this way (a `package.json` referenced by the root `workspaces` field), and since Nx 18 plugins infer the
 * targets, so `project.json` is needed only for custom configuration. A workspace built that way was previously
 * invisible: the walk looked for `angular.json` or `project.json` and found neither.
 *
 * `package.json` has no project type, so the type is `null` — which is exactly what it means.
 */
function packageJsonUnit(dir: string): Unit | null {
  const file: string = join(dir, 'package.json');
  const raw: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = readJson(file);
  if (!dependsOnAngular(raw)) return null;
  return { name: raw?.name ?? basename(dir), root: dir, type: null, declaredBy: 'package.json' };
}

/** An `angular.json` sitting directly in `dir`, describing this one project. */
function angularJsonUnit(dir: string): Unit | null {
  if (!existsSync(join(dir, 'angular.json'))) return null;
  const declared: Unit[] = angularJsonUnits(dir);
  // A single-project `angular.json` describes THIS folder; a multi-project one is a workspace, handled by the caller.
  if (declared.length === 1) return { ...declared[0], root: dir };
  return declared.length ? null : { name: basename(dir), root: dir, type: 'application', declaredBy: 'angular.json' };
}

/**
 * The projects an `angular.json` declares. An Angular CLI workspace lists its apps and libraries here, each with
 * a `root` relative to the workspace. Empty when there is no `angular.json` (an Nx workspace, typically).
 */
export function angularJsonUnits(dir: string): Unit[] {
  const raw: { projects?: Record<string, { root?: string; sourceRoot?: string; projectType?: string }> } | null = readJson(
    join(dir, 'angular.json'),
  );
  if (!raw?.projects) return [];
  return Object.entries(raw.projects).map(([name, p]): Unit => ({
    name,
    root: resolve(dir, p.root ?? p.sourceRoot ?? '.'),
    type: asUnitType(p.projectType),
    declaredBy: 'angular.json',
  }));
}

/** Narrow a raw `projectType` string to the two values the schema allows. Anything else is unstated. */
function asUnitType(raw: string | undefined): UnitType {
  return raw === 'application' || raw === 'library' ? raw : null;
}

/** Last path segment, without pulling in `path.basename`'s platform quirks on a trailing separator. */
function basename(dir: string): string {
  const parts: string[] = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

/**
 * Is `dir` itself a unit? Checked in declaration-strength order: an `angular.json` describes a project outright,
 * a `project.json` names and types it, and a `package.json` depending on Angular is the weakest but real signal.
 */
export function unitAt(dir: string): Unit | null {
  return angularJsonUnit(dir) ?? projectJsonUnit(dir) ?? packageJsonUnit(dir);
}

/**
 * Walk `root`'s subfolders for units. Never the root itself: a monorepo root carries `@angular/core` in its own
 * `package.json` while being no project at all, and treating it as one would offer the whole repository as a
 * migration target. A found unit is a leaf — the walk does not descend into it, `node_modules`, or dot-folders.
 */
export function findUnits(root: string, maxDepth: number = MAX_DEPTH): Unit[] {
  const found: Unit[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (depth >= 1) {
      const unit: Unit | null = unitAt(dir);
      if (unit) {
        found.push(unit);
        return;
      }
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p: string = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        /* unreadable entry — skip */
      }
    }
  };
  walk(root, 0);
  return found.sort((a: Unit, b: Unit): number => a.root.localeCompare(b.root));
}

/**
 * Inspect a source repository: what markers it carries, and what is migratable inside it.
 *
 * A multi-project `angular.json` at the root declares its own units, and those are authoritative — they carry
 * names and types the directory walk cannot know. Everything else is found by walking.
 */
export function inspect(dir: string): Workspace {
  const root: string = resolve(dir);
  const signals: Signal[] = readSignals(root);
  const declared: Unit[] = angularJsonUnits(root);
  const units: Unit[] = declared.length > 1 ? declared : findUnits(root);
  return { root, signals, units, scannedDepth: MAX_DEPTH };
}
