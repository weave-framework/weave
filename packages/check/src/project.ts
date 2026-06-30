/**
 * Discovery + one-shot project check. Walks a directory for both authoring forms —
 * `.weave` SFCs and `.ts` components — builds a virtual module for each, and
 * type-checks them all in a single program. A `.ts` component's template/styles are
 * resolved the same way the build plugin resolves them (see `extractSources`): a
 * declared inline/file `template`, else the sibling `name.html`.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { extractSources, classifyTemplate, faithfulTemplate, type ExtractedSources } from '@weave-framework/compiler';
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
    out.push(absolutize(buildVirtualSfc(path, readFileSync(path, 'utf8'))));
  } else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
    const v: Virtual | null = collectTs(path);
    if (v) out.push(absolutize(v));
  }
}

/**
 * Make a virtual's module path absolute so cross-component imports resolve to it.
 * TypeScript resolves a relative import specifier to an ABSOLUTE path; the host's
 * lookup table is keyed on `v.path`, so an unresolved relative key would miss and
 * fall through to the on-disk source (which lacks the synthesized default export).
 * Display paths (`scriptFile`/`templateFile`) stay as-passed, so diagnostics keep
 * their tidy relative form.
 */
function absolutize(v: Virtual): Virtual {
  v.path = resolve(v.path);
  return v;
}

/** Resolve a `.ts` component's template into a virtual (or null if it is not a component). */
function collectTs(tsPath: string): Virtual | null {
  const source: string = readFileSync(tsPath, 'utf8');
  const decl: ExtractedSources = extractSources(source);
  const siblingHtml: string = tsPath.replace(/\.ts$/, '.html');

  if (decl.template !== undefined) {
    if (classifyTemplate(decl.template) === 'inline') {
      // Offset-faithful: template at its real `.ts` offsets, everything else blanked,
      // so diagnostics map back to the `.ts` line:col.
      const faithful: string = decl.templateRange
        ? faithfulTemplate(source, decl.templateRange)
        : decl.template;
      return buildVirtualSeparate(tsPath, decl.script, tsPath, faithful);
    }
    const file: string = resolve(dirname(tsPath), decl.template);
    if (!existsSync(file)) return null; // build reports the missing file; check just skips
    return buildVirtualSeparate(tsPath, decl.script, file, readFileSync(file, 'utf8'));
  }

  if (existsSync(siblingHtml)) {
    return buildVirtualSeparate(tsPath, decl.script, siblingHtml, readFileSync(siblingHtml, 'utf8'));
  }
  return null; // ordinary module
}
