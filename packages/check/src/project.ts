/**
 * Discovery + one-shot project check. Walks a directory for both authoring forms —
 * `.weave` SFCs and `.ts` components — builds a virtual module for each, and
 * type-checks them all in a single program. A `.ts` component's template/styles are
 * resolved the same way the build plugin resolves them (see `extractSources`): a
 * declared inline/file `template`, else the sibling `name.html`.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { extractSources, classifyTemplate, faithfulTemplate, ParseError, type ExtractedSources } from '@weave-framework/compiler';
import { buildVirtualSfc, buildVirtualSeparate, type Virtual } from './emit.js';
import { runCheck, offsetToLineCol, type Diagnostic } from './check.js';

const SKIP: Set<string> = new Set(['node_modules', 'dist', '.git', '.weave']);

/** Build virtuals for every component found under `roots`, then check them together. A template
 *  that fails to PARSE (e.g. a malformed attribute) becomes a normal `file:line:col` diagnostic
 *  rather than a thrown stack trace, so one bad template no longer aborts the whole check. */
export function checkProject(roots: string[]): Diagnostic[] {
  const virtuals: Virtual[] = [];
  const parseDiags: Diagnostic[] = [];
  for (const root of roots) collect(root, virtuals, parseDiags);
  return [...parseDiags, ...(virtuals.length ? runCheck(virtuals) : [])];
}

/** Turn a compiler {@link ParseError} into a source-located diagnostic. `source` is the exact text
 *  the parser saw, whose offsets map 1:1 to `file` (the sibling `.html`, or the offset-faithful
 *  `.weave`/inline-template region). */
function parseDiagnostic(file: string, source: string, e: ParseError): Diagnostic {
  const { line, col }: { line: number; col: number } = offsetToLineCol(source, e.offset ?? 0);
  return { file, line, col, code: 0, message: e.message, category: 'error' };
}

/** Run a virtual builder; a `ParseError` becomes a diagnostic (any other error still throws). */
function tryBuild(build: () => Virtual, file: string, source: string, out: Virtual[], diags: Diagnostic[]): void {
  try {
    out.push(absolutize(build()));
  } catch (e) {
    if (e instanceof ParseError) {
      diags.push(parseDiagnostic(file, source, e));
      return;
    }
    throw e;
  }
}

function collect(path: string, out: Virtual[], diags: Diagnostic[]): void {
  if (!existsSync(path)) return;
  const st: ReturnType<typeof statSync> = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP.has(entry)) continue;
      collect(join(path, entry), out, diags);
    }
    return;
  }
  if (path.endsWith('.weave')) {
    // A `.weave` template parses `parseSfcLoc(source).template`, which blanks the script/style
    // regions in place — so offsets map 1:1 back to the raw `.weave` source.
    const source: string = readFileSync(path, 'utf8');
    tryBuild(() => buildVirtualSfc(path, source), path, source, out, diags);
  } else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
    collectTs(path, out, diags);
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

/** Resolve a `.ts` component's template into a virtual (or nothing if it is not a component); a
 *  parse failure is recorded as a diagnostic against the offending template file. */
function collectTs(tsPath: string, out: Virtual[], diags: Diagnostic[]): void {
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
      tryBuild(() => buildVirtualSeparate(tsPath, decl.script, tsPath, faithful), tsPath, faithful, out, diags);
      return;
    }
    const file: string = resolve(dirname(tsPath), decl.template);
    if (!existsSync(file)) return; // build reports the missing file; check just skips
    const html: string = readFileSync(file, 'utf8');
    tryBuild(() => buildVirtualSeparate(tsPath, decl.script, file, html), file, html, out, diags);
    return;
  }

  if (existsSync(siblingHtml)) {
    const html: string = readFileSync(siblingHtml, 'utf8');
    tryBuild(() => buildVirtualSeparate(tsPath, decl.script, siblingHtml, html), siblingHtml, html, out, diags);
    return;
  }
  // ordinary module → not a component
}
