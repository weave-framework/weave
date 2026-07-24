/**
 * `weave migrate` — assisted migration into Weave (RFC 0011). This module is the M1 slice: the command's front
 * door and the source-app path resolution. It does NOT analyze or convert yet (that is M2+).
 *
 * The path resolution is the interesting part: a user may point at a plain Angular app OR at a monorepo root
 * (Nx) whose real app sits deeper in `apps/*`. So detection looks AT the path and, if needed, INSIDE it, and
 * suggests what it found. Zero third-party deps — Node built-ins only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface, emitKeypressEvents, type Interface } from 'node:readline';
import { findEntryPoint, walkDependencies, type DependencyWalk } from './migrate-analyze.js';

interface InputManager {
  /** Free-text prompt (a path). Returns the trimmed line, or '' at EOF. */
  askLine: (prompt: string) => Promise<string>;
  /** A menu: arrow-key + Enter in a real terminal, number-typing under piped input or on any fallback. -1 = none. */
  selectMenu: (title: string, options: string[]) => Promise<number>;
  /** True once stdin has ended AND its buffered lines are all consumed — the caller must stop asking. */
  done: () => boolean;
  close: () => void;
}

/**
 * Input over BOTH a real terminal and piped stdin. Text uses a buffered line-queue (`readline.question` drops a
 * line under piped input — the line event can fire before the next question registers its callback). A menu
 * navigates with the arrow keys + Enter in a TTY, and degrades to typing a number when piped or if raw mode is
 * unavailable — so a menu is never broken, only prettier in a real terminal.
 */
function inputManager(): InputManager {
  const rl: Interface = createInterface({ input: process.stdin, terminal: false });
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed: boolean = false;
  // After a TTY arrow-select, the confirming Enter leaks into the resumed readline as one empty line — swallow it
  // once so the next text prompt is not skipped (which showed the path prompt twice).
  let swallowEmpty: boolean = false;
  rl.on('line', (l: string) => {
    const w: ((line: string) => void) | undefined = waiters.shift();
    if (w) w(l);
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w('');
  });

  const rawRead = (): Promise<string | null> => {
    const next: string | undefined = queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (closed) return Promise.resolve(null); // EOF
    return new Promise<string | null>((res) => waiters.push((l) => res(l)));
  };

  const askLine = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    let line: string | null = await rawRead();
    if (swallowEmpty) {
      swallowEmpty = false;
      if (line === '') line = await rawRead(); // discard the Enter that confirmed an arrow-menu pick
    }
    return line === null ? '' : line.trim();
  };

  /** Fallback menu: print numbered options, read one line, parse the number (or the option text). */
  const selectByNumber = async (title: string, options: string[]): Promise<number> => {
    let out: string = `\n${title}\n`;
    options.forEach((o, i) => (out += `  ${i + 1}) ${o}\n`));
    const a: string = await askLine(`${out}> `);
    const n: number = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    return options.findIndex((o) => o.toLowerCase() === a.toLowerCase());
  };

  /** Arrow-key menu (TTY only): highlight a row, ↑/↓ to move, Enter to pick. Any hiccup → number fallback. */
  const selectByArrows = (title: string, options: string[]): Promise<number> =>
    new Promise<number>((res, rej) => {
      const stdin: NodeJS.ReadStream = process.stdin;
      let idx: number = 0;
      let top: number = 0; // first visible option (the window scrolls as idx moves past its edges)
      const VIEW: number = Math.min(10, options.length);
      const HEIGHT: number = 1 + VIEW + 1; // title + window rows + hint line — a constant, so redraw is exact
      emitKeypressEvents(stdin);
      const trunc = (s: string): string => {
        const w: number = (process.stdout.columns ?? 80) - 4;
        return s.length > w ? `…${s.slice(s.length - w + 1)}` : s; // left-truncate: keep the app name (path end)
      };
      const draw = (first: boolean): void => {
        if (idx < top) top = idx;
        else if (idx >= top + VIEW) top = idx - VIEW + 1;
        if (!first) process.stdout.write(`\x1b[${HEIGHT}A`); // cursor up to redraw in place
        process.stdout.write(`\x1b[2K${title}\n`);
        for (let i: number = 0; i < VIEW; i++) {
          const oi: number = top + i;
          process.stdout.write(`\x1b[2K${oi === idx ? '\x1b[36m> ' : '  '}${trunc(options[oi])}\x1b[0m\n`);
        }
        const more: string[] = [];
        if (top > 0) more.push(`↑${top} more`);
        if (top + VIEW < options.length) more.push(`↓${options.length - top - VIEW} more`);
        process.stdout.write(`\x1b[2K\x1b[2m${more.join('  ')}  (${idx + 1}/${options.length})\x1b[0m\n`);
      };
      const cleanup = (): void => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(false);
        rl.resume();
      };
      const onKey = (_s: string, key: { name?: string; ctrl?: boolean } | undefined): void => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }
        if (key.name === 'up') idx = (idx - 1 + options.length) % options.length;
        else if (key.name === 'down') idx = (idx + 1) % options.length;
        else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          res(idx);
          return;
        } else return;
        draw(false);
      };
      try {
        rl.pause();
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume(); // keep the stream flowing + ref'd, else the event loop empties and Node exits before a keypress
        stdin.on('keypress', onKey);
        process.stdout.write('\n');
        draw(true);
      } catch (e) {
        cleanup();
        rej(e);
      }
    });

  return {
    askLine,
    async selectMenu(title: string, options: string[]): Promise<number> {
      if (!process.stdin.isTTY) return selectByNumber(title, options);
      try {
        const picked: number = await selectByArrows(title, options);
        swallowEmpty = true; // the confirming Enter will surface as one empty line — the next askLine drops it
        return picked;
      } catch {
        return selectByNumber(title, options);
      }
    },
    done: () => closed && queue.length === 0,
    close: () => rl.close(),
  };
}

/** Does `dir` DIRECTLY contain an Angular app? `angular.json`, or a `package.json` that depends on `@angular/core`. */
export function detectAngularAt(dir: string): boolean {
  if (existsSync(join(dir, 'angular.json'))) return true;
  const pkg: string = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = JSON.parse(
        readFileSync(pkg, 'utf8'),
      );
      const deps: Record<string, string> = { ...j.dependencies, ...j.devDependencies };
      if (deps['@angular/core']) return true;
    } catch {
      /* a malformed package.json is not an Angular signal */
    }
  }
  return false;
}

/**
 * An Nx `project.json` that is an Angular unit — an application OR a library. Both are migratable: a service or
 * a component lives inside a library just as much as inside an app, so we do NOT filter libraries out. A big
 * workspace therefore surfaces MANY units, and that is the point — too many to list becomes "type the exact
 * path" (a path can point at any unit, down to a single service folder). Matched by any `@angular` reference.
 */
export function isNxAngularProject(dir: string): boolean {
  const proj: string = join(dir, 'project.json');
  if (!existsSync(proj)) return false;
  try {
    const raw: string = JSON.stringify(JSON.parse(readFileSync(proj, 'utf8')));
    return raw.includes('@angular-devkit') || raw.includes('@nx/angular') || raw.includes('@angular/');
  } catch {
    return false;
  }
}

/** A monorepo ROOT we should look INSIDE rather than treat as the app itself (Nx, or a workspaces root). */
export function looksLikeMonorepo(dir: string): boolean {
  if (existsSync(join(dir, 'nx.json'))) return true;
  if (existsSync(join(dir, 'apps'))) return true;
  const pkg: string = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      if ((JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown }).workspaces) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** One project listed in an `angular.json` — an Angular CLI workspace declares its apps + libs here. */
export interface AngularProject {
  name: string;
  /** Absolute path to the project's root folder. */
  root: string;
  /** 'application' or 'library' (defaults to 'application' when unstated). */
  type: string;
}

/** Read the projects an `angular.json` declares. Empty if there is no `angular.json` (e.g. an Nx workspace). */
export function readAngularProjects(dir: string): AngularProject[] {
  const f: string = join(dir, 'angular.json');
  if (!existsSync(f)) return [];
  try {
    const j: { projects?: Record<string, { root?: string; sourceRoot?: string; projectType?: string }> } = JSON.parse(
      readFileSync(f, 'utf8'),
    );
    return Object.entries(j.projects ?? {}).map(([name, p]) => ({
      name,
      root: resolve(dir, p.root ?? p.sourceRoot ?? '.'),
      type: p.projectType ?? 'application',
    }));
  } catch {
    return [];
  }
}

/**
 * Search `root`'s SUBFOLDERS for Angular apps (never the root itself — a monorepo root carries `@angular/core`
 * but is not an app). An app is a subfolder with its own `angular.json`, or an Nx `project.json` with an Angular
 * build target. A found app is a leaf — the walk does not descend into it, `node_modules`, or dot-dirs.
 */
export function findAngularApps(root: string, maxDepth: number = 5): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (depth >= 1 && (existsSync(join(dir, 'angular.json')) || isNxAngularProject(dir))) {
      found.push(dir);
      return; // a found unit is a leaf
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
  return found;
}

/** The outcome of resolving a user-typed path to a real Angular app. */
export interface Resolution {
  /** Resolved unambiguously to a single app. */
  app?: string;
  /** Found several (a monorepo) — the user picks one. */
  candidates?: string[];
  /** Nothing here or inside. */
  none?: boolean;
}

/** A lone hit auto-resolves; several become candidates the user picks; none means nothing was found. */
function pickFrom(apps: string[]): Resolution {
  if (apps.length === 1) return { app: apps[0] };
  return apps.length ? { candidates: apps } : { none: true };
}

/**
 * Resolve a user-typed path to a migration target (an app OR a library — both migratable; a service/component
 * lives inside one). In order:
 * 1. An Angular CLI workspace whose `angular.json` lists SEVERAL projects → offer them all.
 * 2. A monorepo (Nx / `apps/`) → look INSIDE for its units (its root has `@angular/core` but is not itself one).
 * 3. A single unit pointed at directly (one `angular.json` project, or `@angular/core`) → resolve to itself.
 * 4. Otherwise search inside as a fallback.
 * When the result is many, the caller shows "too many — type the exact path" rather than a giant menu.
 */
export function resolveAngularApp(input: string): Resolution {
  const dir: string = resolve(input);
  if (!existsSync(dir)) return { none: true };

  const units: string[] = readAngularProjects(dir).map((p) => p.root); // apps AND libraries — both migratable
  if (units.length > 1) return pickFrom(units); // a multi-project Angular CLI workspace

  if (looksLikeMonorepo(dir)) return pickFrom(findAngularApps(dir)); // Nx / apps-workspace → look inside

  // A directly-typed path to a single unit: a plain Angular app (angular.json / @angular/core), or an Nx project
  // the user explicitly navigated to — trust the explicit choice (its `project.json` marks it; M2 confirms it's
  // Angular). This is what lets a user point straight at one service/library inside a big workspace.
  if (units.length === 1 || detectAngularAt(dir) || existsSync(join(dir, 'project.json'))) return { app: dir };

  return pickFrom(findAngularApps(dir)); // fallback: units may live deeper
}

/* ──────────── the interactive command (thin shell over the pure functions above) ──────────── */

const SOURCES: string[] = ['Angular', 'React', 'Vue'];

/** Above this many candidates a scrollable menu is worse than typing the exact path — so we ask for one instead. */
const MENU_MAX: number = 10;

/** `weave migrate` entry — pick a framework, resolve the source app path, confirm. Analysis/convert is M2+. */
export async function runMigrate(): Promise<void> {
  const io: InputManager = inputManager();
  try {
    // 1) framework — arrow-key menu (TTY) or numbered (piped)
    const fw: number = await io.selectMenu('Migrate from which framework?', SOURCES);
    if (fw < 0 && io.done()) return; // no input at all — nothing to do
    const source: string | undefined = SOURCES[fw];
    if (source !== 'Angular') {
      console.log(source ? `${source} is coming soon. Only Angular is supported today.` : 'Unknown choice.');
      return;
    }

    // 2) path, with deep detection (an app, a library — a service/component migrates from inside one)
    let app: string | undefined;
    while (!app) {
      const input: string = await io.askLine('\nPath to your Angular app or the piece to migrate (full path):\n> ');
      if (!input) {
        if (io.done()) {
          console.log('\nNo path given. Nothing to migrate.');
          return;
        }
        continue;
      }
      const r: Resolution = resolveAngularApp(input.replace(/^["']|["']$/g, ''));
      if (r.app) {
        app = r.app;
      } else if (r.candidates && r.candidates.length > MENU_MAX) {
        // Too many to pick from a list — show a few so the user knows where they live, then ask for the exact one.
        console.log(`\nFound ${r.candidates.length} Angular projects in there — too many to list. A few of them:`);
        r.candidates.slice(0, 5).forEach((c) => console.log(`  ${c}`));
        console.log('  …');
        console.log('Type the exact path to what you want to migrate (an app, a library, or a service inside one):');
        continue; // the loop re-prompts; an exact path resolves straight to that one unit
      } else if (r.candidates && r.candidates.length) {
        console.log('\nNo single unit right there. I looked inside and found these — pick one (or Ctrl-C to retype):');
        const c: number = await io.selectMenu('Which one?', r.candidates);
        if (c >= 0 && r.candidates[c]) app = r.candidates[c];
      } else {
        console.log('No Angular app or project found here or inside. Type another path:');
      }
      if (!app && io.done()) {
        console.log('\nNothing resolved. Nothing to migrate.');
        return;
      }
    }

    console.log(`\nUsing: ${app}`);

    // 3) analyze — find the entry, walk the dependency tree DOWN to the leaves (M2)
    const entry: string | null = findEntryPoint(app);
    if (!entry) {
      console.log("Couldn't find an entry file (main.ts / index.ts) — point at the unit's folder, or a specific file.");
      return;
    }
    console.log(`Entry: ${entry}\nAnalyzing (following imports down to the leaves)...\n`);
    const walk: DependencyWalk = walkDependencies(entry);
    const list = (xs: string[], n: number): string => (xs.length ? `${xs.slice(0, n).join(', ')}${xs.length > n ? ', …' : ''}` : '(none)');
    console.log('Found:');
    console.log(`  ${walk.files.length} source files`);
    console.log(`  ${walk.angular.length} @angular APIs used (these become Weave): ${list(walk.angular, 6)}`);
    if (walk.internal.length) console.log(`  ${walk.internal.length} of your own workspace libs (migrated too): ${list(walk.internal, 6)}`);
    console.log(`  ${walk.thirdParty.length} third-party packages (keep / replace / rewrite): ${list(walk.thirdParty, 8)}`);
    if (walk.cycles.length) console.log(`  ⚠ ${walk.cycles.length} circular-dependency chain(s) — will be flagged for you`);
    if (walk.unresolved.length) console.log(`  ⚠ ${walk.unresolved.length} import(s) couldn't be resolved — human, look`);
    console.log('\n(the written plan + conversion come next — see RFC 0011)');
  } finally {
    io.close();
  }
}
