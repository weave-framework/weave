/**
 * Weave codegen — turns a template AST into JS that creates DOM once and wires
 * fine-grained signal bindings via the `@weave/runtime/dom` helpers.
 *
 * Static structure becomes hoisted `<template>` strings with `<!---->` comment
 * anchors at dynamic positions; dynamic nodes are reached by compile-time
 * child-index paths. Control-flow blocks compile to `ifBlock`/`eachBlock` calls
 * whose branch/row bodies are nested render functions (so they close over `ctx`
 * and any template locals), keeping every block's effects in its own scope.
 */

import { parseTemplate } from './parser.js';
import type {
  TemplateNode, ElementNode, Attr, EventAttr, IfNode, ForNode, SwitchNode,
} from './ast.js';
import { rewrite, ctxScope, childScope, type Scope } from './scope.js';

export interface CompileOptions {
  /** binding names (from setup()) to resolve via `ctx.*` */
  scope?: string[];
  /** 'module' → importable ES module (default); 'function' → body for `new Function('ctx','rt', …)` */
  mode?: 'module' | 'function';
  runtimeImport?: string;
}

class Gen {
  used = new Set<string>(); // @weave/runtime/dom helpers
  usedCore = new Set<string>(); // @weave/runtime primitives (computed, …)
  templates: string[] = [];
  private tplN = 0;
  private fnN = 0;

  constructor(public mode: 'module' | 'function') {}

  H(name: string): string {
    this.used.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  Hc(name: string): string {
    this.usedCore.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  tpl(html: string): string {
    const v = `_t${this.tplN++}`;
    this.templates.push(`const ${v} = ${this.H('template')}(${JSON.stringify(html)});`);
    return v;
  }
  fn(prefix = '_b'): string {
    return `${prefix}${this.fnN++}`;
  }
}

export function compileTemplate(input: string, options: CompileOptions = {}): { code: string } {
  const mode = options.mode ?? 'module';
  const runtimeImport = options.runtimeImport ?? '@weave/runtime/dom';
  const gen = new Gen(mode);

  const ast = parseTemplate(input);
  const render = compileFragment(gen, ast, ctxScope(options.scope ?? []), 'render', 'ctx');

  if (mode === 'function') {
    const body = [...gen.templates, render, 'return render(ctx);'].join('\n');
    return { code: body };
  }

  const domImport = `import { ${[...gen.used].sort().join(', ')} } from ${JSON.stringify(runtimeImport)};`;
  const coreImport = gen.usedCore.size
    ? `import { ${[...gen.usedCore].sort().join(', ')} } from "@weave/runtime";\n`
    : '';
  const code = [domImport + '\n' + coreImport, ...gen.templates, `export default ${render}`].join('\n');
  return { code };
}

/** Compile a list of nodes into a `function name(param){…}` declaration. */
function compileFragment(
  gen: Gen,
  nodes: TemplateNode[],
  scope: Scope,
  name: string,
  param = '',
  requireSingleRoot = false
): string {
  const top = trimTop(nodes);
  if (top.length === 0) throw new Error('Empty template fragment');
  const singleRoot = top.length === 1 && top[0].type === 'element';
  if (requireSingleRoot && !singleRoot) {
    throw new Error('A @for row body must have a single root element');
  }

  let html = '';
  const stmts: string[] = [];
  const childDecls: string[] = [];

  // Resolve each dynamic node into a local BEFORE any binding runs: a binding
  // inserts nodes, which would shift the child indices later `child()` lookups
  // rely on. Capturing the (stable) node references up front avoids that.
  const nodeDecls: string[] = [];
  const nodeVars = new Map<string, string>();
  let nodeVarN = 0;
  const nodeExpr = (path: number[]): string => {
    if (path.length === 0) return '_r';
    const key = path.join(',');
    let v = nodeVars.get(key);
    if (!v) {
      v = `_n${nodeVarN++}`;
      nodeVars.set(key, v);
      nodeDecls.push(`const ${v} = ${gen.H('child')}(_r, ${path.join(', ')});`);
    }
    return v;
  };

  function emitChildren(children: TemplateNode[], basePath: number[], sc: Scope): void {
    let dom = 0;
    let cur = sc;
    for (const node of children) {
      if (node.type === 'let') {
        html += '<!---->'; // placeholder slot keeps child indices stable
        stmts.push(`const ${node.name} = ${gen.Hc('computed')}(() => ${rewrite(node.expr, cur).code});`);
        cur = childScope(cur, { [node.name]: node.name });
        dom++;
        continue;
      }
      emitNode(node, [...basePath, dom], cur);
      dom++;
    }
  }

  function emitNode(node: TemplateNode, path: number[], sc: Scope): void {
    switch (node.type) {
      case 'text':
        html += escapeText(node.value);
        return;
      case 'interp': {
        html += '<!---->';
        const { code, reactive } = rewrite(node.expr, sc);
        stmts.push(
          reactive
            ? `${gen.H('bindText')}(${nodeExpr(path)}, () => ${code});`
            : `${gen.H('setText')}(${nodeExpr(path)}, ${code});`
        );
        return;
      }
      case 'element':
        emitElement(node, path, sc);
        return;
      case 'if':
        emitIf(node, path, sc);
        return;
      case 'for':
        emitFor(node, path, sc);
        return;
      case 'switch':
        emitSwitch(node, path, sc);
        return;
      case 'let':
        throw new Error('@let cannot be a single dynamic node here');
    }
  }

  function emitElement(node: ElementNode, path: number[], sc: Scope): void {
    if (/^[A-Z]/.test(node.tag)) throw new Error(`Components (<${node.tag}>) arrive in M5`);
    html += `<${node.tag}`;
    for (const attr of node.attrs) {
      if (attr.type === 'static') {
        html += attr.value === '' ? ` ${attr.name}` : ` ${attr.name}="${escapeAttr(attr.value)}"`;
      } else {
        emitBinding(attr, path, sc);
      }
    }
    html += '>';
    if (!node.selfClosing) {
      emitChildren(node.children, path, sc);
      html += `</${node.tag}>`;
    }
  }

  function emitBinding(attr: Exclude<Attr, { type: 'static' }>, path: number[], sc: Scope): void {
    const n = nodeExpr(path);
    switch (attr.type) {
      case 'attr': {
        const { code, reactive } = rewrite(attr.expr, sc);
        stmts.push(
          reactive
            ? `${gen.H('bindAttr')}(${n}, ${q(attr.name)}, () => ${code});`
            : `${gen.H('setAttr')}(${n}, ${q(attr.name)}, ${code});`
        );
        break;
      }
      case 'prop':
        stmts.push(`${gen.H('bindProp')}(${n}, ${q(attr.name)}, () => ${rewrite(attr.expr, sc).code});`);
        break;
      case 'class':
        stmts.push(`${gen.H('bindClass')}(${n}, ${q(attr.name)}, () => ${rewrite(attr.expr, sc).code});`);
        break;
      case 'event': {
        const handler = wrapHandler(attr, sc);
        const opts = eventOpts(attr.modifiers);
        stmts.push(`${gen.H('listen')}(${n}, ${q(attr.name)}, ${handler}${opts ? `, ${opts}` : ''});`);
        break;
      }
      case 'ref':
        stmts.push(`${gen.H('setRef')}(${rewrite(attr.expr, sc).code}, ${n});`);
        break;
      case 'bind':
        throw new Error('bind: (two-way binding) arrives in M10');
    }
  }

  function emitIf(node: IfNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const head = node.branches[0];
    let aliasVar: string | undefined;
    if (head.alias) {
      aliasVar = gen.fn('_a');
      stmts.push(`const ${aliasVar} = ${gen.Hc('computed')}(() => ${rewrite(head.cond ?? 'undefined', sc).code});`);
    }

    const branchNames = node.branches.map(() => gen.fn());
    node.branches.forEach((br, i) => {
      const bScope = i === 0 && head.alias && aliasVar
        ? childScope(sc, { [head.alias]: aliasVar })
        : sc;
      childDecls.push(compileFragment(gen, br.children, bScope, branchNames[i]));
    });

    const lines: string[] = [];
    node.branches.forEach((br, i) => {
      if (i === 0 && aliasVar) lines.push(`if (${aliasVar}()) return ${branchNames[i]};`);
      else if (br.cond !== undefined) lines.push(`if (${rewrite(br.cond, sc).code}) return ${branchNames[i]};`);
      else lines.push(`return ${branchNames[i]};`);
    });
    const hasElse = node.branches[node.branches.length - 1].cond === undefined;
    if (!hasElse) lines.push('return null;');

    stmts.push(`${gen.H('ifBlock')}(${nodeExpr(path)}, () => { ${lines.join(' ')} });`);
  }

  function emitSwitch(node: SwitchNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const names = node.cases.map(() => gen.fn());
    node.cases.forEach((c, i) => childDecls.push(compileFragment(gen, c.children, sc, names[i])));

    const lines = [`const _v = ${rewrite(node.expr, sc).code};`];
    node.cases.forEach((c, i) => {
      if (c.test !== undefined) lines.push(`if (_v === ${rewrite(c.test, sc).code}) return ${names[i]};`);
      else lines.push(`return ${names[i]};`);
    });
    if (!node.cases.some((c) => c.test === undefined)) lines.push('return null;');

    stmts.push(`${gen.H('ifBlock')}(${nodeExpr(path)}, () => { ${lines.join(' ')} });`);
  }

  function emitFor(node: ForNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const rowFn = gen.fn();
    const forScope = childScope(sc, {
      [node.item]: '_row.item',
      $index: '_row.index',
      $count: '_row.count',
      $first: '_row.first',
      $last: '_row.last',
      $even: '_row.even',
      $odd: '_row.odd',
    });
    childDecls.push(compileFragment(gen, node.children, forScope, rowFn, '_row', true));

    let emptyArg = '';
    if (node.empty) {
      const emptyFn = gen.fn();
      childDecls.push(compileFragment(gen, node.empty, sc, emptyFn));
      emptyArg = `, ${emptyFn}`;
    }

    const list = rewrite(node.list, sc).code;
    const track = node.track ? rewrite(node.track, sc).code : '$index';
    const keyFn = `(${node.item}, $index) => ${track}`;
    stmts.push(`${gen.H('eachBlock')}(${nodeExpr(path)}, () => ${list}, ${keyFn}, ${rowFn}${emptyArg});`);
  }

  // walk
  if (singleRoot) emitElement(top[0] as ElementNode, [], scope);
  else emitChildren(top, [], scope);

  const ctor = singleRoot ? gen.H('clone') : gen.H('cloneFragment');
  const tplVar = gen.tpl(html);
  const body = [
    `const _r = ${ctor}(${tplVar});`,
    ...nodeDecls,
    ...stmts,
    'return _r;',
    ...childDecls,
  ];
  return `function ${name}(${param}) {\n${body.map((l) => '  ' + l).join('\n')}\n}`;
}

/* ──────────── helpers ──────────── */

function wrapHandler(attr: EventAttr, scope: Scope): string {
  const expr = rewrite(attr.expr, scope).code;
  const guards: string[] = [];
  for (const m of attr.modifiers) {
    if (m === 'preventDefault') guards.push('$e.preventDefault();');
    else if (m === 'stopPropagation') guards.push('$e.stopPropagation();');
    else if (m === 'self') guards.push('if ($e.target !== $e.currentTarget) return;');
  }
  if (guards.length === 0) return expr;
  return `($e) => { ${guards.join(' ')} (${expr})($e); }`;
}

function eventOpts(modifiers: string[]): string {
  const opts: string[] = [];
  if (modifiers.includes('once')) opts.push('once: true');
  if (modifiers.includes('capture')) opts.push('capture: true');
  if (modifiers.includes('passive')) opts.push('passive: true');
  return opts.length ? `{ ${opts.join(', ')} }` : '';
}

function trimTop(nodes: TemplateNode[]): TemplateNode[] {
  return nodes.filter((n) => !(n.type === 'text' && n.value.trim() === ''));
}

function q(s: string): string {
  return JSON.stringify(s);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
