/**
 * `parsers.weave.parse` — reuse the Weave compiler's parser to build the AST, then PRE-FORMAT every
 * embedded expression (and, for SFCs, the `<script>`/`<style>` bodies) by delegating to Prettier's
 * own `typescript`/`css`/`scss` printers. Doing this async pass here keeps the printer purely
 * synchronous string/doc assembly.
 */
import { parseTemplate, parseSfcLoc } from '@weave-framework/compiler';
import type { TemplateNode, Attr, ComponentSourceLoc } from '@weave-framework/compiler';
import { format } from 'prettier';
import type { Options, ParserOptions } from 'prettier';
import type { SfcBlock, WeaveRoot } from './ast.js';

// Linear (no catastrophic backtracking): a zero-width `(?=[\s>])` assertion replaces the ambiguous
// `\s[^>]*` (where `\s ⊆ [^>]`), and `[^>]*>` has disjoint char classes. `STYLE_LANG` runs on the
// captured attribute slice (STYLE_OPEN group 1), never the whole document — so `lang` can only match
// inside the actual `<style …>` tag.
export const SCRIPT_OPEN: RegExp = /<script(?=[\s>])[^>]*>/i;
export const STYLE_OPEN: RegExp = /<style(?=[\s>])([^>]*)>/i;
export const STYLE_LANG: RegExp = /\blang\s*=\s*["']?(scss|sass|css)/i;

export async function parseWeave(text: string, options: ParserOptions): Promise<WeaveRoot> {
  if (!isSfc(text, options)) {
    const nodes: TemplateNode[] = parseTemplate(text, { comments: true });
    await formatNodes(nodes, options);
    return { type: 'weave-root', variant: 'template', nodes, raw: text };
  }

  const loc: ComponentSourceLoc = parseSfcLoc(text);
  const nodes: TemplateNode[] = parseTemplate(loc.template, { comments: true });
  await formatNodes(nodes, options);

  const blocks: SfcBlock[] = [];
  const scriptM: RegExpMatchArray | null = text.match(SCRIPT_OPEN);
  if (loc.script && scriptM) {
    blocks.push({
      kind: 'script',
      at: scriptM.index ?? 0,
      open: scriptM[0],
      content: (await formatOrRaw(loc.script, { ...base(options), parser: 'typescript' })).trim(),
    });
  }
  const styleM: RegExpMatchArray | null = text.match(STYLE_OPEN);
  if (loc.styles && styleM) {
    const langM: RegExpMatchArray | null = (styleM[1] ?? '').match(STYLE_LANG);
    const parser: string = langM && (langM[1] === 'scss' || langM[1] === 'sass') ? 'scss' : 'css';
    blocks.push({
      kind: 'style',
      at: styleM.index ?? 0,
      open: styleM[0],
      content: (await formatOrRaw(loc.styles, { ...base(options), parser })).trim(),
    });
  }
  if (hasSignificant(nodes)) {
    blocks.push({ kind: 'template', at: firstNonSpace(loc.template) });
  }
  blocks.sort((a, b) => a.at - b.at);

  return { type: 'weave-root', variant: 'sfc', nodes, blocks, raw: text };
}

/* ─────────────── SFC / template detection ─────────────── */

function isSfc(text: string, options: ParserOptions): boolean {
  const fp: string = (options.filepath ?? '').toLowerCase();
  if (fp.endsWith('.weave')) return true;
  if (fp.endsWith('.html') || fp.endsWith('.htm')) return false;
  // No (or some other) extension — infer from content.
  return SCRIPT_OPEN.test(text) || STYLE_OPEN.test(text);
}

/* ─────────────── expression pre-formatting ─────────────── */

/** Inherit the user's layout options for every sub-format call. */
function base(options: ParserOptions): Options {
  return {
    printWidth: options.printWidth,
    tabWidth: options.tabWidth,
    useTabs: options.useTabs,
    singleQuote: options.singleQuote,
    trailingComma: options.trailingComma,
    bracketSpacing: options.bracketSpacing,
    semi: options.semi,
  };
}

/** Format a JS/TS expression via Prettier's expression parser; return it untouched if it can't parse. */
async function formatExpr(expr: string | undefined, options: ParserOptions): Promise<string | undefined> {
  if (expr == null) return expr;
  const trimmed: string = expr.trim();
  if (!trimmed) return trimmed;
  try {
    const out: string = await format(trimmed, { ...base(options), parser: '__ts_expression', semi: false });
    return out.trim();
  } catch {
    return trimmed;
  }
}

/** Format a whole block (script/style); return the raw body untouched if it can't parse. */
async function formatOrRaw(src: string, opts: Options): Promise<string> {
  try {
    return await format(src, opts);
  } catch {
    return src;
  }
}

async function formatNodes(nodes: TemplateNode[], options: ParserOptions): Promise<void> {
  for (const node of nodes) await formatNode(node, options);
}

async function formatNode(node: TemplateNode, options: ParserOptions): Promise<void> {
  switch (node.type) {
    case 'text':
    case 'comment':
      return;
    case 'interp':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      return;
    case 'element':
      for (const attr of node.attrs) await formatAttr(attr, options);
      await formatNodes(node.children, options);
      return;
    case 'if':
      for (const br of node.branches) {
        if (br.cond != null) br.cond = await formatExpr(br.cond, options);
        await formatNodes(br.children, options);
      }
      return;
    case 'for':
      node.list = (await formatExpr(node.list, options)) ?? node.list;
      if (node.track) node.track = await formatExpr(node.track, options);
      await formatNodes(node.children, options);
      if (node.empty) await formatNodes(node.empty, options);
      return;
    case 'switch':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      for (const c of node.cases) {
        if (c.test != null) c.test = await formatExpr(c.test, options);
        await formatNodes(c.children, options);
      }
      return;
    case 'let':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      return;
    case 'defer':
      if (node.trigger.kind === 'when') node.trigger.expr = (await formatExpr(node.trigger.expr, options)) ?? node.trigger.expr;
      await formatNodes(node.children, options);
      if (node.placeholder) await formatNodes(node.placeholder, options);
      return;
    case 'await':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      if (node.pending) await formatNodes(node.pending, options);
      if (node.then) await formatNodes(node.then.children, options);
      if (node.catch) await formatNodes(node.catch.children, options);
      return;
    case 'render':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      return;
    case 'key':
      node.expr = (await formatExpr(node.expr, options)) ?? node.expr;
      await formatNodes(node.children, options);
      return;
    case 'snippet':
      await formatNodes(node.children, options);
      return;
  }
}

async function formatAttr(attr: Attr, options: ParserOptions): Promise<void> {
  if (attr.type === 'static') return;
  if (attr.expr != null) attr.expr = (await formatExpr(attr.expr, options)) ?? attr.expr;
}

/* ─────────────── small helpers ─────────────── */

function hasSignificant(nodes: TemplateNode[]): boolean {
  return nodes.some((n) => !(n.type === 'text' && /^\s*$/.test(n.value)));
}

function firstNonSpace(s: string): number {
  const m: RegExpMatchArray | null = s.match(/\S/);
  return m ? (m.index ?? 0) : 0;
}
