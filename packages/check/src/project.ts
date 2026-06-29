/**
 * Discovery + one-shot project check. Walks a directory for the two authoring
 * forms — `.weave` SFCs and separate `name.ts` + `name.html` pairs — builds a
 * virtual module for each, and type-checks them all in a single program.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildVirtualSfc, buildVirtualSeparate, type Virtual } from './emit.js';
import { runCheck, type Diagnostic } from './check.js';

const SKIP: Set<string> = new Set(['node_modules', 'dist', '.git', '.weave']);

/** Build virtuals for every component found under `roots`, then check them together. */
export function checkProject(roots: string[]): Diagnostic[] {
  const virtuals: Virtual[] = [];
  for (const root of roots) collect(root, virtuals);
  return virtuals.length ? runCheck(virtuals) : [];
}

function collect(path: string, out: Virtual[]): void {
  if (!existsSync(path)) return;
  const st: ReturnType<typeof statSync> = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP.has(entry)) continue;
      collect(join(path, entry), out);
    }
    return;
  }
  if (path.endsWith('.weave')) {
    out.push(buildVirtualSfc(path, readFileSync(path, 'utf8')));
  } else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
    const html: string = path.replace(/\.ts$/, '.html');
    if (existsSync(html)) {
      out.push(buildVirtualSeparate(path, readFileSync(path, 'utf8'), html, readFileSync(html, 'utf8')));
    }
  }
}
