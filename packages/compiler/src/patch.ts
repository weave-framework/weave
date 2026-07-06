/**
 * RFC 0008 `#3` — declarative template patches for component-file extensions.
 *
 * A `#3` extension does NOT write its own template; it declares `export const patch = [...]`,
 * an array of ops that modify the BASE component's template. The loader resolves the base
 * template, parses it, and this module applies the ops to the AST (matched by a small
 * tag/class/attribute selector), then codegen compiles the patched AST directly — no
 * round-trip through template text. Fail-loud: a selector that matches nothing throws.
 *
 * Ops are pure DATA (not a function), so the loader reads them statically without evaluating
 * the extension module. Markup an op inserts (`html`) and the attribute an `attr` op adds
 * (`attr`) are ordinary Weave template text, parsed by the SAME parser — so `{{ }}`, `on:`,
 * `use:`, `@if`/`@for`, and nested components all work inside a patch.
 */

import { parseTemplate } from './parser.js';
import type { TemplateNode, ElementNode, Attr, StaticAttr } from './ast.js';

/** A declarative patch op. Authored as an entry of `export const patch = [ … ]`. */
export type PatchOp =
  /** Add (or replace) an attribute/binding on matched elements. `attr` is markup, e.g. `on:dblclick={{ f(item) }}`. */
  | { op: 'attr'; sel: string; attr: string }
  /** Remove a named attribute/binding from matched elements. */
  | { op: 'removeAttr'; sel: string; name: string }
  /** Insert `html` as the first / last child of matched elements. */
  | { op: 'prepend' | 'append'; sel: string; html: string }
  /** Insert `html` as the previous / next sibling of matched elements. */
  | { op: 'before' | 'after'; sel: string; html: string }
  /** Replace matched elements with `html`. */
  | { op: 'replace'; sel: string; html: string }
  /** Wrap each matched element in `html` (its single root becomes the matched element's parent). */
  | { op: 'wrap'; sel: string; html: string }
  /** Remove matched elements. */
  | { op: 'remove'; sel: string };

const NODE_OPS: ReadonlySet<string> = new Set(['prepend', 'append', 'before', 'after', 'replace', 'wrap', 'remove']);

/** The child-node arrays a template node contains (where matches live and edits happen). */
function childArrays(node: TemplateNode): TemplateNode[][] {
  switch (node.type) {
    case 'element':
      return [node.children];
    case 'if':
      return node.branches.map((b) => b.children);
    case 'for':
      return node.empty ? [node.children, node.empty] : [node.children];
    case 'switch':
      return node.cases.map((c) => c.children);
    case 'defer':
      return node.placeholder ? [node.children, node.placeholder] : [node.children];
    case 'await': {
      const arrs: TemplateNode[][] = [];
      for (const key of ['pending', 'children', 'then', 'catch'] as const) {
        const v: TemplateNode[] | undefined = (node as unknown as Record<string, TemplateNode[] | undefined>)[key];
        if (Array.isArray(v)) arrs.push(v);
      }
      return arrs;
    }
    case 'key':
      return [node.children];
    case 'snippet':
      return [node.children];
    default:
      return [];
  }
}

/** Parse one selector: `tag`, `.class`, `[attr]`, or `[attr=value]`. */
interface Selector {
  tag?: string;
  className?: string;
  attrName?: string;
  attrValue?: string;
}
function parseSelector(sel: string): Selector {
  const s: string = sel.trim();
  if (s.startsWith('.')) return { className: s.slice(1) };
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner: string = s.slice(1, -1);
    const eq: number = inner.indexOf('=');
    if (eq === -1) return { attrName: inner.trim() };
    return { attrName: inner.slice(0, eq).trim(), attrValue: inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '') };
  }
  return { tag: s };
}

function staticAttr(node: ElementNode, name: string): StaticAttr | undefined {
  return node.attrs.find((a): a is StaticAttr => a.type === 'static' && a.name === name);
}

function matches(node: ElementNode, sel: Selector): boolean {
  if (sel.tag !== undefined) return node.tag === sel.tag;
  if (sel.className !== undefined) {
    const cls: StaticAttr | undefined = staticAttr(node, 'class');
    return !!cls && cls.value.split(/\s+/).includes(sel.className);
  }
  if (sel.attrName !== undefined) {
    if (sel.attrValue !== undefined) {
      const a: StaticAttr | undefined = staticAttr(node, sel.attrName);
      return !!a && a.value === sel.attrValue;
    }
    return node.attrs.some((a: Attr) => 'name' in a && a.name === sel.attrName);
  }
  return false;
}

/** All element nodes matching `sel`, deepest-first is not required — insertion re-locates by identity. */
function collectMatches(ast: TemplateNode[], sel: Selector): ElementNode[] {
  const out: ElementNode[] = [];
  const walk = (nodes: TemplateNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'element' && matches(n, sel)) out.push(n);
      for (const arr of childArrays(n)) walk(arr);
    }
  };
  walk(ast);
  return out;
}

/** A node's location: its containing array + index within it. */
interface Loc {
  arr: TemplateNode[];
  index: number;
}

/** Locate a node by identity: its containing array + index. */
function locate(ast: TemplateNode[], target: TemplateNode): Loc | null {
  const walk = (nodes: TemplateNode[]): Loc | null => {
    const i: number = nodes.indexOf(target);
    if (i !== -1) return { arr: nodes, index: i };
    for (const n of nodes) {
      for (const arr of childArrays(n)) {
        const hit: Loc | null = walk(arr);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(ast);
}

/** Parse a bare attribute string (e.g. `on:click={{ f }}`) by wrapping it in a dummy element. */
function parseAttr(attrText: string): Attr {
  const [el] = parseTemplate(`<w-patch ${attrText}/>`) as ElementNode[];
  if (!el || el.type !== 'element' || el.attrs.length !== 1) {
    throw new Error(`weave: patch attr must be a single attribute, got: ${attrText}`);
  }
  return el.attrs[0];
}

/**
 * Apply declarative patch ops to a base template AST (mutates a shallow copy). Fail-loud: a
 * selector matching no element throws — a patch that no longer applies (the base restructured
 * its markup) must not silently vanish.
 */
export function applyPatches(ast: TemplateNode[], ops: PatchOp[]): TemplateNode[] {
  const root: TemplateNode[] = ast.slice();
  for (const op of ops) {
    const sel: Selector = parseSelector(op.sel);
    const hits: ElementNode[] = collectMatches(root, sel);
    if (hits.length === 0) {
      throw new Error(`weave: patch selector '${op.sel}' matched no element in the base template (op '${op.op}').`);
    }
    for (const node of hits) {
      if (op.op === 'attr') {
        const next: Attr = parseAttr(op.attr);
        const name: string | undefined = 'name' in next ? next.name : undefined;
        node.attrs = node.attrs.filter((a) => !('name' in a && name !== undefined && a.name === name)).concat(next);
        continue;
      }
      if (op.op === 'removeAttr') {
        node.attrs = node.attrs.filter((a) => !('name' in a && a.name === op.name));
        continue;
      }
      if (op.op === 'prepend' || op.op === 'append') {
        const frag: TemplateNode[] = parseTemplate(op.html);
        node.children = op.op === 'prepend' ? frag.concat(node.children) : node.children.concat(frag);
        continue;
      }
      // sibling / self ops need the node's location in its parent array
      if (NODE_OPS.has(op.op)) {
        const loc: Loc | null = locate(root, node);
        if (!loc) continue; // already removed by a prior op in this batch
        const frag: TemplateNode[] = 'html' in op ? parseTemplate(op.html) : [];
        if (op.op === 'before') loc.arr.splice(loc.index, 0, ...frag);
        else if (op.op === 'after') loc.arr.splice(loc.index + 1, 0, ...frag);
        else if (op.op === 'replace') loc.arr.splice(loc.index, 1, ...frag);
        else if (op.op === 'remove') loc.arr.splice(loc.index, 1);
        else if (op.op === 'wrap') {
          const wrapper: ElementNode | undefined = frag.find((n): n is ElementNode => n.type === 'element');
          if (!wrapper) throw new Error(`weave: patch 'wrap' html must contain an element, got: ${op.html}`);
          wrapper.children = wrapper.children.concat(node);
          loc.arr.splice(loc.index, 1, ...frag);
        }
      }
    }
  }
  return root;
}
