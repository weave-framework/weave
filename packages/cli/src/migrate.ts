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
import { createInterface, type Interface } from 'node:readline';

/**
 * A prompt reader that works over BOTH a real terminal and piped input. `readline.question` drops a line under
 * piped stdin (the line event can fire before the next question registers its callback); this buffers every line
 * as it arrives and hands them out in order, so a scripted `printf '…' | weave migrate` behaves like a human.
 */
interface LineReader {
  ask: (prompt: string) => Promise<string>;
  /** True once stdin has ended AND its buffered lines are all consumed — the caller must stop asking. */
  done: () => boolean;
  close: () => void;
}

function lineReader(): LineReader {
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
  return {
    ask(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const next: string | undefined = queue.shift();
      if (next !== undefined) return Promise.resolve(next.trim());
      if (closed) return Promise.resolve('');
      return new Promise<string>((res) => waiters.push((l) => res(l.trim())));
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

/** Search `root` a few levels deep for Angular apps; does not descend into a found app or `node_modules`. */
export function findAngularApps(root: string, maxDepth: number = 3): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (detectAngularAt(dir) || isNxAngularProject(dir)) {
      found.push(dir);
      return; // a found app is a leaf — don't descend into it
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

/**
 * Resolve a user-typed path. A monorepo root is looked INSIDE (its real apps live in `apps/*`), never treated as
 * the app; a plain app path resolves to itself; anything else is searched, and a lone hit auto-resolves.
 */
export function resolveAngularApp(input: string): Resolution {
  const dir: string = resolve(input);
  if (!existsSync(dir)) return { none: true };
  if (looksLikeMonorepo(dir)) {
    const found: string[] = findAngularApps(dir);
    if (found.length === 1) return { app: found[0] };
    return found.length ? { candidates: found } : { none: true };
  }
  if (detectAngularAt(dir)) return { app: dir };
  const found: string[] = findAngularApps(dir);
  if (found.length === 1) return { app: found[0] };
  return found.length ? { candidates: found } : { none: true };
}

/* ──────────── the interactive command (thin shell over the pure functions above) ──────────── */

const SOURCES: string[] = ['Angular', 'React', 'Vue'];

/** `weave migrate` entry — pick a framework, resolve the source app path, confirm. Analysis/convert is M2+. */
export async function runMigrate(): Promise<void> {
  const io: LineReader = lineReader();
  try {
    // 1) framework
    let out: string = '\nMigrate from which framework?\n';
    SOURCES.forEach((s, i) => (out += `  ${i + 1}) ${s}\n`));
    const pick: string = await io.ask(`${out}> `);
    if (!pick && io.done()) return; // no input at all — nothing to do
    const source: string | undefined = /^\d+$/.test(pick) ? SOURCES[Number(pick) - 1] : SOURCES.find((s) => s.toLowerCase() === pick.toLowerCase());
    if (source !== 'Angular') {
      console.log(source ? `${source} is coming soon. Only Angular is supported today.` : 'Unknown choice.');
      return;
    }

    // 2) path, with deep detection
    let app: string | undefined;
    while (!app) {
      const input: string = await io.ask('\nPath to your Angular app (full path):\n> ');
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
        let list: string = '\nNo Angular app right there. I looked inside and found:\n';
        r.candidates.forEach((c, i) => (list += `  ${i + 1}) ${c}\n`));
        const c: string = await io.ask(`${list}Pick one, or type another path:\n> `);
        if (/^\d+$/.test(c) && r.candidates[Number(c) - 1]) app = r.candidates[Number(c) - 1];
        else if (c) {
          const rr: Resolution = resolveAngularApp(c);
          if (rr.app) app = rr.app;
        }
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
