/**
 * Directory browsing for the migration UI.
 *
 * A browser cannot hand a server a real path: `showDirectoryPicker()` returns a handle whose only identity is a
 * NAME, and `<input webkitdirectory>` gives paths relative to whatever was picked. Both are deliberate — the
 * platform will not disclose where a folder lives. So the picker has to be ours, reading the filesystem through
 * the service, which already has that access.
 *
 * That turns out to be better than a native dialog rather than a fallback for one: every folder can be listed
 * with the markers it carries, so you see WHERE the Angular projects are while choosing, instead of picking
 * blind and finding out after the scan.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import type { Entry, Listing, Peek } from './types.js';

/** Files whose presence says something about a folder, in the order the UI shows them. */
const MARKERS: string[] = ['angular.json', 'project.json', 'nx.json', 'package.json', 'pnpm-workspace.yaml'];

/** Which markers `dir` holds. Cheap: a handful of `existsSync` calls per folder. */
function markersAt(dir: string): string[] {
  return MARKERS.filter((m: string): boolean => existsSync(join(dir, m)));
}

/**
 * Drive letters that actually exist, on Windows. There is no dependency-free API for this, so the letters are
 * probed — 26 `existsSync` calls, once per roots listing, which costs nothing and avoids shelling out.
 */
function windowsDrives(): string[] {
  const found: string[] = [];
  for (let c: number = 65; c <= 90; c++) {
    const root: string = `${String.fromCharCode(c)}:\\`;
    try {
      if (existsSync(root)) found.push(root);
    } catch {
      /* an unreadable drive is not a drive we can offer */
    }
  }
  return found;
}

/** Where to start: the drives (Windows) or `/`, so a user on any platform has somewhere to click. */
function roots(): Entry[] {
  const list: string[] = process.platform === 'win32' ? windowsDrives() : ['/'];
  return list.map((p: string): Entry => ({ name: p, path: p, markers: [] }));
}

/** Home and the working directory — the two folders a project is most often under. */
function shortcuts(): Entry[] {
  const out: Entry[] = [];
  const seen: Set<string> = new Set<string>();
  for (const [name, path] of [
    ['Home', homedir()],
    ['Current folder', process.cwd()],
  ] as Array<[string, string]>) {
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    out.push({ name, path, markers: markersAt(path) });
  }
  return out;
}

/**
 * List the folders inside `path`, or the filesystem roots when it is empty.
 *
 * `node_modules` and dot-folders are left out. They are never a migration target, and in a real repository they
 * are most of what a listing would otherwise be — the same exclusion the unit walk already makes, for the same
 * reason.
 */
export function browse(path: string): Listing {
  if (!path) return { path: '', parent: null, entries: roots(), shortcuts: shortcuts() };

  const dir: string = resolve(path);
  const names: string[] = readdirSync(dir);
  const entries: Entry[] = [];
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full: string = join(dir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue; // a link to nowhere, or a folder this process may not stat
    }
    entries.push({ name, path: full, markers: markersAt(full) });
  }
  entries.sort((a: Entry, b: Entry): number => a.name.localeCompare(b.name));

  // At a filesystem root, `dirname` returns the root itself — that would be an "up" button that does nothing,
  // so it reports null and the UI offers the roots listing instead.
  const up: string = dirname(dir);
  const parent: string | null = up === dir || dir === parse(dir).root ? null : up;

  return { path: dir, parent, entries, shortcuts: shortcuts() };
}

/**
 * What is at `path`, without listing anything.
 *
 * The source field is silent until Scan is pressed, so a typed or pasted path gives no sign of being right until
 * after the wait. This answers that in one call: does it exist, is it a folder, and what markers does it carry —
 * the same markers the picker shows, so both halves of the screen say the same thing about the same folder.
 *
 * `browse()` could answer it too, but only by reading the entire directory, which is a lot of work to learn
 * whether a path is worth scanning.
 */
export function peek(path: string): Peek {
  const dir: string = resolve(path);
  try {
    if (!statSync(dir).isDirectory()) return { path: dir, exists: true, directory: false, markers: [] };
  } catch {
    return { path: dir, exists: false, directory: false, markers: [] };
  }
  return { path: dir, exists: true, directory: true, markers: markersAt(dir) };
}

export type { Entry, Listing, Peek } from './types.js';
