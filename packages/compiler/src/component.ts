/**
 * Component loader — composes the three pieces of a component (script / template
 * / styles) into one ES module. The same hash drives both the template's scope
 * attribute and the scoped CSS, so a single `compileComponent` call keeps them
 * in lockstep (no cross-file coordination).
 *
 * Authoring contract: the script EXPORTS `setup` (a named export); the loader
 * appends the compiled `render` and synthesizes the default export
 * `defineComponent(render, setup)` — append-only, never edits user code.
 *
 * Both authoring forms reduce here: a `.weave` SFC is split by {@link parseSfc}
 * into the same `{ script, template, styles }` triple the separate-file path
 * passes directly.
 */

import { compileTemplate } from './codegen.js';
import { parseTemplate } from './parser.js';
import { inferCtxNames } from './infer.js';
import { scopeCss, scopeAttr, hostAttr, hashCss } from './css.js';

export interface ComponentSource {
  /** Setup module — user imports + `export function setup(props) { … return bindings }`. */
  script?: string;
  /** Template markup. */
  template: string;
  /** Component CSS (scoped to this component). */
  styles?: string;
}

export interface ComponentOptions {
  /** Shared scope hash; defaults to a hash of `filename` (else the template). */
  hash?: string;
  /** Resolved component path — used for the default hash and debugging. */
  filename?: string;
}

export interface CompiledComponent {
  /** The component ES module. */
  code: string;
  /** Scoped CSS — the esbuild plugin collects these into one stylesheet. */
  css: string;
  /** The scope hash both halves share. */
  hash: string;
}

const HAS_SETUP: RegExp = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;

/** Compile a `{ script, template, styles }` triple into a component module + scoped CSS. */
export function compileComponent(src: ComponentSource, opts: ComponentOptions = {}): CompiledComponent {
  const hash: string = opts.hash ?? hashCss(opts.filename ?? src.template);
  const attr: string = scopeAttr(hash);

  const scope: string[] = inferCtxNames(parseTemplate(src.template));
  // Stamp the `:host` root marker only when the styles actually use `:host` (else zero cost).
  const host: string | undefined = src.styles && /:host\b/.test(src.styles) ? hostAttr(hash) : undefined;
  const compiled: { code: string } = compileTemplate(src.template, { mode: 'module', scope, scopeAttr: attr, hostAttr: host });
  // Demote the template module's default export to a local `render` we can wire up.
  const renderBody: string = compiled.code.replace('export default function render', 'function render');

  const css: string = src.styles ? scopeCss(src.styles, hash) : '';
  const script: string = src.script ?? '';
  const setupArg: string = HAS_SETUP.test(script) ? 'render, setup' : 'render';

  const code: string = [
    script.trim(),
    'import { defineComponent } from "@weave-framework/runtime/dom";',
    renderBody,
    `export default defineComponent(${setupArg});`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { code, css, hash };
}

/**
 * Location-faithful SFC split for `@weave-framework/check`. Unlike {@link parseSfc}, the
 * returned `template` keeps the SFC's exact character offsets: the `<script>`
 * and `<style>` blocks are *blanked* (every non-newline char → a space, newlines
 * kept) rather than removed, so an offset reported by {@link parseTemplate} maps
 * straight back to a `.weave` line:col. `scriptLine` is the 0-based SFC line where
 * the (trimmed) script body begins, used to map type errors in user code.
 */
export interface ComponentSourceLoc {
  script?: string;
  scriptLine: number;
  /** char offset in `source` where the (trimmed) script body begins (0 if no script). */
  scriptOffset: number;
  template: string;
  /** char offset in `source` where the (trimmed) style body begins (0 if no style). */
  styleOffset: number;
  styles?: string;
}

export function parseSfcLoc(source: string): ComponentSourceLoc {
  const script: LocatedBlock | null = locateBlock(source, 'script');
  const style: LocatedBlock | null = locateBlock(source, 'style');
  let template: string = source;
  for (const b of [script, style]) {
    if (b) template = blankRange(template, b.rawStart, b.rawEnd);
  }
  return {
    script: script?.inner || undefined,
    scriptLine: script ? lineAt(source, script.innerStart) : 0,
    scriptOffset: script ? script.innerStart : 0,
    template,
    styleOffset: style ? style.innerStart : 0,
    styles: style?.inner || undefined,
  };
}

interface LocatedBlock {
  rawStart: number;
  rawEnd: number;
  /** offset of the first non-whitespace char of the (trimmed) inner */
  innerStart: number;
  inner: string;
}

function locateBlock(source: string, tag: string): LocatedBlock | null {
  const open: number = source.search(new RegExp(`<${tag}(\\s[^>]*)?>`, 'i'));
  if (open === -1) return null;
  const gt: number = source.indexOf('>', open);
  const close: number = source.toLowerCase().indexOf(`</${tag}>`, gt);
  if (close === -1) return null;
  const rawInner: string = source.slice(gt + 1, close);
  const lead: number = rawInner.length - rawInner.trimStart().length;
  return {
    rawStart: open,
    rawEnd: close + `</${tag}>`.length,
    innerStart: gt + 1 + lead,
    inner: rawInner.trim(),
  };
}

/** Replace `[start, end)` with same-length whitespace, preserving newlines. */
function blankRange(s: string, start: number, end: number): string {
  let mid: string = '';
  for (let i: number = start; i < end; i++) mid += s[i] === '\n' ? '\n' : ' ';
  return s.slice(0, start) + mid + s.slice(end);
}

function lineAt(s: string, offset: number): number {
  let line: number = 0;
  for (let i: number = 0; i < offset && i < s.length; i++) if (s[i] === '\n') line++;
  return line;
}

/** Split a `.weave` SFC into its `{ script, template, styles }` triple. */
export function parseSfc(source: string): ComponentSource {
  const script: { raw: string; inner: string } = extractBlock(source, 'script');
  const style: { raw: string; inner: string } = extractBlock(source, 'style');
  const template: string = source
    .replace(script.raw, '')
    .replace(style.raw, '')
    .trim();
  return {
    script: script.inner || undefined,
    template,
    styles: style.inner || undefined,
  };
}

function extractBlock(source: string, tag: string): { raw: string; inner: string } {
  const open: number = source.search(new RegExp(`<${tag}(\\s[^>]*)?>`, 'i'));
  if (open === -1) return { raw: '', inner: '' };
  const gt: number = source.indexOf('>', open);
  const close: number = source.toLowerCase().indexOf(`</${tag}>`, gt);
  if (close === -1) return { raw: '', inner: '' };
  const end: number = close + `</${tag}>`.length;
  return { raw: source.slice(open, end), inner: source.slice(gt + 1, close).trim() };
}
