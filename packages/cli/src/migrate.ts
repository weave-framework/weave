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
  rl.on('line', (l: string) => {
    const w: ((line: string) => void) | undefined = waiters.shift();
    if (w) w(l);
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w('');
  });

  const askLine = (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    const next: string | undefined = queue.shift();
    if (next !== undefined) return Promise.resolve(next.trim());
    if (closed) return Promise.resolve('');
    return new Promise<string>((res) => waiters.push((l) => res(l.trim())));
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
      emitKeypressEvents(stdin);
      const draw = (first: boolean): void => {
        if (!first) process.stdout.write(`\x1b[${options.length + 1}A`); // cursor up to redraw in place
        process.stdout.write(`${title}\n`);
        options.forEach((o, i) => process.stdout.write(`\x1b[2K${i === idx ? '\x1b[36m> ' : '  '}${o}\x1b[0m\n`));
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
        return await selectByArrows(title, options);
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

/** An Nx project (`project.json`) whose build target is Angular — the app markers in a monorepo's `apps/*`. */
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
      return; // a found app is a leaf
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
 * Resolve a user-typed path to a real Angular app. In order:
 * 1. An Angular CLI workspace whose `angular.json` lists SEVERAL application projects → offer those.
 * 2. A monorepo (Nx / `apps/`) → look INSIDE for the real apps (its root has `@angular/core` but is not an app).
 * 3. A single app pointed at directly (one `angular.json` project, or `@angular/core`) → resolve to itself.
 * 4. Otherwise search inside as a fallback.
 */
export function resolveAngularApp(input: string): Resolution {
  const dir: string = resolve(input);
  if (!existsSync(dir)) return { none: true };

  const apps: string[] = readAngularProjects(dir).filter((p) => p.type === 'application').map((p) => p.root);
  if (apps.length > 1) return pickFrom(apps); // a multi-project Angular CLI workspace

  if (looksLikeMonorepo(dir)) return pickFrom(findAngularApps(dir)); // Nx / apps-workspace → look inside

  if (apps.length === 1 || detectAngularAt(dir)) return { app: dir }; // a single app, pointed at directly

  return pickFrom(findAngularApps(dir)); // fallback: apps may live deeper
}

/* ──────────── the interactive command (thin shell over the pure functions above) ──────────── */

const SOURCES: string[] = ['Angular', 'React', 'Vue'];

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

    // 2) path, with deep detection
    let app: string | undefined;
    while (!app) {
      const input: string = await io.askLine('\nPath to your Angular app (full path):\n> ');
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
      } else if (r.candidates && r.candidates.length) {
        console.log('\nNo Angular app right there. I looked inside and found these — pick one (or Ctrl-C to retype):');
        const c: number = await io.selectMenu('Which app?', r.candidates);
        if (c >= 0 && r.candidates[c]) app = r.candidates[c];
      } else {
        console.log('No Angular app found here or inside. Type another path:');
      }
      if (!app && io.done()) {
        console.log('\nNo Angular app resolved. Nothing to migrate.');
        return;
      }
    }

    console.log(`\nUsing: ${app}`);
    console.log('(analysis + conversion come next — see RFC 0011)');
  } finally {
    io.close();
  }
}
