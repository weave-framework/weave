/** `weave routes` — generate a `Route[]` module from a pages directory. */

import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// Import the DOM-free subpath so the node CLI tsconfig never reaches into the
// router's runtime (DOM) code — these are pure string functions.
import { fileToRoutes, emitRoutesModule } from '@weave/router/files';
import type { FileRoute } from '@weave/router/files';

const PAGE: RegExp = /\.(weave|tsx?|jsx?)$/;
// The generated module + sibling templates/styles are not pages — skip them so a
// re-scan never turns its own output (or a page's `.html`/`.scss`) into a route.
const NOT_A_PAGE: RegExp = /\.(gen|d)\.[mc]?tsx?$/;

/** Recursively collect page-file specifiers under `dir`, relative to it (POSIX, sorted). */
export function scanRoutes(dir: string): string[] {
  const out: string[] = [];
  const walk = (cur: string): void => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full: string = join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (PAGE.test(entry.name) && !NOT_A_PAGE.test(entry.name))
        out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export interface GenerateRoutesOptions {
  /** Output module path (default `<dir>/routes.gen.ts`). */
  out?: string;
  /** Code-split each page via `lazy()` (default true). */
  lazy?: boolean;
}

/** Scan `dir`, build the manifest, and write the generated routes module. Returns its path. */
export function generateRoutes(dir: string, opts: GenerateRoutesOptions = {}): string {
  const files: string[] = scanRoutes(dir);
  const routes: FileRoute[] = fileToRoutes(files);
  const module: string = emitRoutesModule(routes, { lazy: opts.lazy ?? true });
  const out: string = opts.out ?? join(dir, 'routes.gen.ts');
  writeFileSync(out, module);
  return out;
}
