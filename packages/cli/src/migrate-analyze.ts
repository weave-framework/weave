/**
 * `weave migrate` — the analyzer (RFC 0011, M2). It MEASURES facts about the selected unit: starting at the
 * unit's entry point, it will follow what the code DEPENDS ON (downward, branching to the leaves), stopping at
 * `@angular/*` (the source framework — translated, never recursed into) and third-party packages (noted at the
 * edge). This file is the facts side only; the plan + conversion are later (M3/M4). Zero third-party deps.
 *
 * This slice (M2.1): find the selected unit's ENTRY point — where the walk begins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Try `rel` under `unitDir`; if it doesn't resolve (a workspace-relative path), strip leading segments until it does. */
function resolveUnder(unitDir: string, rel: string): string | null {
  const direct: string = join(unitDir, rel);
  if (existsSync(direct)) return direct;
  const parts: string[] = rel.split(/[\\/]/).filter(Boolean);
  for (let i: number = 1; i < parts.length; i++) {
    const p: string = join(unitDir, ...parts.slice(i));
    if (existsSync(p)) return p;
  }
  return null;
}

/** The `main`/`browser` entry a build target declares (Nx `project.json` or Angular `angular.json`), if any. */
function entryFromConfig(unitDir: string): string | null {
  for (const cfg of ['project.json', 'angular.json']) {
    const f: string = join(unitDir, cfg);
    if (!existsSync(f)) continue;
    try {
      const j: unknown = JSON.parse(readFileSync(f, 'utf8'));
      // project.json: targets.*.options.{main,browser}; angular.json: projects.*.architect|targets.*.options.*
      const mains: string[] = [];
      const collect = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const rec: Record<string, unknown> = o as Record<string, unknown>;
        for (const key of ['main', 'browser']) {
          if (typeof rec[key] === 'string') mains.push(rec[key] as string);
        }
        for (const v of Object.values(rec)) if (v && typeof v === 'object') collect(v);
      };
      collect(j);
      for (const m of mains) {
        const resolved: string | null = resolveUnder(unitDir, m);
        if (resolved) return resolved;
      }
    } catch {
      /* malformed config — fall through to conventions */
    }
  }
  return null;
}

/** Common entry files, in priority order: an app's `main.ts`, then a library's public entry. */
const CONVENTIONAL_ENTRIES: string[] = [
  'src/main.ts',
  'src/index.ts',
  'src/public-api.ts',
  'src/public_api.ts',
  'index.ts',
  'public-api.ts',
];

/**
 * The entry point of a selected unit — where the dependency walk begins. A build target's declared `main`/
 * `browser` wins (most accurate); otherwise the conventional entry files are probed. Returns an absolute path,
 * or null when none is found (the caller records "couldn't find an entry — human, look", never guesses).
 */
export function findEntryPoint(unitDir: string): string | null {
  const fromConfig: string | null = entryFromConfig(unitDir);
  if (fromConfig) return fromConfig;
  for (const rel of CONVENTIONAL_ENTRIES) {
    const p: string = join(unitDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}
