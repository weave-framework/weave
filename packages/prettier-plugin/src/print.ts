/**
 * `printers['weave-ast'].print` — turn the wrapped AST back into a Prettier doc. Expressions and
 * SFC script/style bodies are already formatted (see parse.ts), so this is synchronous structural
 * assembly: element/attribute layout, control-flow reindentation, comment + `@@` preservation.
 *
 * Whitespace policy (v1, deliberately conservative — see the package README): an element whose
 * children include real text or an interpolation is printed INLINE (whitespace collapsed to single
 * spaces, never reflowed) so nothing semantic changes; an element whose children are only other
 * elements / blocks / comments is printed as an indented BLOCK.
 */
import { doc } from 'prettier';
import type { AstPath, Doc, ParserOptions } from 'prettier';
import type { TemplateNode, Attr } from '@weave-framework/compiler';
import type { SfcBlock, WeaveRoot } from './ast.js';
import { escapeAt } from './escape.js';

const { group, indent, join, line, hardline, softline, literalline } = doc.builders;

export function printWeave(path: AstPath<WeaveRoot>, options: ParserOptions): Doc {
  const root: WeaveRoot = path.node;
  if (root.variant === 'sfc') return printSfc(root, options);
  return [printBlock(root.nodes, options), hardline];
}

/* ─────────────── SFC ─────────────── */

function printSfc(root: WeaveRoot, options: ParserOptions): Doc {
  const blocks: SfcBlock[] = root.blocks ?? [];
  const parts: Doc[] = blocks.map((b) => printSfcBlock(b, root, options));
  return [join([hardline, hardline], parts), hardline];
}

function printSfcBlock(block: SfcBlock, root: WeaveRoot, options: ParserOptions): Doc {
  if (block.kind === 'template') return printBlock(root.nodes, options);
  const close: string = block.kind === 'script' ? '</script>' : '</style>';
  return [block.open ?? `<${block.kind}>`, hardline, block.content ?? '', hardline, close];
}

/* ─────────────── node lists ─────────────── */

/** Block context: drop whitespace-only text, one node per line. */
function printBlock(nodes: TemplateNode[], options: ParserOptions): Doc {
  const kept: TemplateNode[] = nodes.filter((n) => !(n.type === 'text' && isBlank(n.value)));
  return join(hardline, kept.map((n) => printNode(n, options)));
}

/** Inline context: collapse whitespace to single spaces, keep everything on the flowing line. */
function printInline(nodes: TemplateNode[], options: ParserOptions): Doc {
  const parts: Doc[] = [];
  for (const n of nodes) {
    if (n.type === 'text') parts.push(escapeAt(collapse(n.value)));
    else if (n.type === 'interp') parts.push(`{{ ${n.expr} }}`);
    else if (n.type === 'comment') parts.push(printComment(n.value));
    else parts.push(printNode(n, options));
  }
  return parts;
}

/** A control-flow / element body: always indented on its own lines between `{`…`}` or tags. */
function printBody(nodes: TemplateNode[], options: ParserOptions): Doc {
  const inner: Doc = shouldInline(nodes) ? printInline(nodes, options) : printBlock(nodes, options);
  return [indent([hardline, inner]), hardline];
}

/* ─────────────── single nodes ─────────────── */

function printNode(node: TemplateNode, options: ParserOptions): Doc {
  switch (node.type) {
    case 'text':
      return escapeAt(collapse(node.value).trim());
    case 'comment':
      return printComment(node.value);
    case 'interp':
      return `{{ ${node.expr} }}`;
    case 'element':
      return printElement(node, options);
    case 'if':
      return printIf(node, options);
    case 'for':
      return printFor(node, options);
    case 'switch':
      return printSwitch(node, options);
    case 'let':
      return `@let ${node.name} = ${node.expr};`;
    case 'defer':
      return printDefer(node, options);
    case 'await':
      return printAwait(node, options);
    case 'snippet':
      return ['@snippet ', node.name, '(', node.params.join(', '), ') {', printBody(node.children, options), '}'];
    case 'render':
      return `@render (${node.expr})`;
    case 'key':
      return ['@key (', node.expr, ') {', printBody(node.children, options), '}'];
  }
}

/* ─────────────── elements ─────────────── */

const RAW_TEXT: ReadonlySet<string> = new Set(['pre', 'textarea']);

function printElement(node: Extract<TemplateNode, { type: 'element' }>, options: ParserOptions): Doc {
  if (node.selfClosing) return openTag(node, options, true);
  const open: Doc = openTag(node, options, false);
  const closeTag: string = `</${node.tag}>`;

  if (node.children.length === 0) return [open, closeTag];
  if (RAW_TEXT.has(node.tag.toLowerCase())) return [open, printRaw(node.children), closeTag];
  if (shouldInline(node.children)) return [open, printInline(node.children, options), closeTag];
  return [open, indent([hardline, printBlock(node.children, options)]), hardline, closeTag];
}

function openTag(node: Extract<TemplateNode, { type: 'element' }>, options: ParserOptions, selfClose: boolean): Doc {
  const tail: Doc = selfClose ? [line, '/>'] : [softline, '>'];
  if (node.attrs.length === 0) return selfClose ? `<${node.tag} />` : `<${node.tag}>`;
  const attrs: Doc = indent(node.attrs.map((a) => [line, printAttr(a)]));
  return group(['<', node.tag, attrs, tail]);
}

/** `<pre>`/`<textarea>` — preserve inner whitespace verbatim. */
function printRaw(nodes: TemplateNode[], options?: ParserOptions): Doc {
  const parts: Doc[] = [];
  for (const n of nodes) {
    if (n.type === 'text') parts.push(join(literalline, n.value.split('\n')));
    else if (n.type === 'interp') parts.push(`{{ ${n.expr} }}`);
    else if (n.type === 'comment') parts.push(printComment(n.value));
    else parts.push(printNode(n, options as ParserOptions));
  }
  return parts;
}

function printAttr(attr: Attr): string {
  switch (attr.type) {
    case 'static':
      return attr.value === '' ? attr.name : `${attr.name}="${attr.value}"`;
    case 'attr':
      return `${attr.name}={{ ${attr.expr} }}`;
    case 'prop':
      return `.${attr.name}={{ ${attr.expr} }}`;
    case 'event':
      return `on:${attr.name}${attr.modifiers.map((m) => `|${m}`).join('')}={{ ${attr.expr} }}`;
    case 'class':
      return `class:${attr.name}={{ ${attr.expr} }}`;
    case 'style':
      return `style:${attr.name}={{ ${attr.expr} }}`;
    case 'bind':
      return `bind:${attr.name}={{ ${attr.expr} }}`;
    case 'ref':
      return `ref={{ ${attr.expr} }}`;
    case 'use':
      return attr.expr != null ? `use:${attr.name}={{ ${attr.expr} }}` : `use:${attr.name}`;
    case 'show':
      return `show={{ ${attr.expr} }}`;
    case 'transition': {
      const prefix: string = attr.mode === 'both' ? 'transition' : attr.mode;
      return attr.expr != null ? `${prefix}:${attr.name}={{ ${attr.expr} }}` : `${prefix}:${attr.name}`;
    }
  }
}

/* ─────────────── control flow ─────────────── */

function printIf(node: Extract<TemplateNode, { type: 'if' }>, options: ParserOptions): Doc {
  const parts: Doc[] = [];
  node.branches.forEach((br, i) => {
    if (i === 0) {
      const alias: string = br.alias ? `; as ${br.alias}` : '';
      parts.push('@if (', br.cond ?? '', alias, ') {');
    } else if (br.cond != null) {
      parts.push(' @else if (', br.cond, ') {');
    } else {
      parts.push(' @else {');
    }
    parts.push(printBody(br.children, options), '}');
  });
  return parts;
}

function printFor(node: Extract<TemplateNode, { type: 'for' }>, options: ParserOptions): Doc {
  const track: string = node.track ? `; track ${node.track}` : '';
  const parts: Doc[] = [`@for (${node.item} of ${node.list}${track}) {`, printBody(node.children, options), '}'];
  if (node.empty) parts.push(' @empty {', printBody(node.empty, options), '}');
  return parts;
}

function printSwitch(node: Extract<TemplateNode, { type: 'switch' }>, options: ParserOptions): Doc {
  const cases: Doc[] = node.cases.map((c) =>
    c.test != null
      ? ['@case (', c.test, ') {', printBody(c.children, options), '}']
      : ['@default {', printBody(c.children, options), '}']
  );
  return [`@switch (${node.expr}) {`, indent([hardline, join(hardline, cases)]), hardline, '}'];
}

function printDefer(node: Extract<TemplateNode, { type: 'defer' }>, options: ParserOptions): Doc {
  const parts: Doc[] = [`@defer (${deferTrigger(node.trigger)}) {`, printBody(node.children, options), '}'];
  if (node.placeholder) parts.push(' @placeholder {', printBody(node.placeholder, options), '}');
  return parts;
}

function deferTrigger(t: Extract<TemplateNode, { type: 'defer' }>['trigger']): string {
  switch (t.kind) {
    case 'when':
      return `when ${t.expr}`;
    case 'timer':
      return `on timer(${t.ms})`;
    case 'immediate':
      return 'immediate';
    default:
      return `on ${t.kind}`; // idle | viewport | interaction | hover
  }
}

function printAwait(node: Extract<TemplateNode, { type: 'await' }>, options: ParserOptions): Doc {
  const parts: Doc[] = [`@await (${node.expr})`];
  if (node.pending) parts.push(' {', printBody(node.pending, options), '}');
  if (node.then) {
    const alias: string = node.then.alias ? ` (${node.then.alias})` : '';
    parts.push(' @then', alias, ' {', printBody(node.then.children, options), '}');
  }
  if (node.catch) {
    const alias: string = node.catch.alias ? ` (${node.catch.alias})` : '';
    parts.push(' @catch', alias, ' {', printBody(node.catch.children, options), '}');
  }
  return parts;
}

/* ─────────────── leaves & helpers ─────────────── */

function printComment(value: string): Doc {
  if (value.includes('\n')) return ['<!--', value, '-->'];
  return `<!-- ${value.trim()} -->`;
}

/** An element/block body is "inline" when it holds real text or an interpolation. */
function shouldInline(nodes: TemplateNode[]): boolean {
  return nodes.some((n) => (n.type === 'text' && !isBlank(n.value)) || n.type === 'interp');
}

function isBlank(s: string): boolean {
  return /^\s*$/.test(s);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}
