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
  TemplateNode, ElementNode, Attr, StaticAttr, EventAttr, IfNode, ForNode, SwitchNode,
  DeferNode, DeferTrigger, AwaitNode, SnippetNode, RenderNode, KeyNode,
} from './ast.js';
import { rewrite, ctxScope, childScope, type Scope, type Binding } from './scope.js';

export interface CompileOptions {
  /** binding names (from setup()) to resolve via `ctx.*` */
  scope?: string[];
  /** 'module' → importable ES module (default); 'function' → body for `new Function('ctx','rt', …)` */
  mode?: 'module' | 'function';
  runtimeImport?: string;
  /** Scoped-CSS attribute (e.g. `data-w-a1b2c3`) stamped on every emitted element. */
  scopeAttr?: string;
  /** `:host` attribute (e.g. `data-w-a1b2c3-h`) stamped on the template's root element(s). */
  hostAttr?: string;
}

class Gen {
  used = new Set<string>(); // @weave/runtime/dom helpers
  usedCore = new Set<string>(); // @weave/runtime primitives (computed, …)
  templates: string[] = [];
  private tplN = 0;
  private fnN = 0;

  constructor(
    public mode: 'module' | 'function',
    public scopeAttr?: string,
    public hostAttr?: string
  ) {}

  H(name: string): string {
    this.used.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  Hc(name: string): string {
    this.usedCore.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  /** Reference a child component: from the `_c` map in function mode, bare (imported) in module mode. */
  Comp(name: string): string {
    return this.mode === 'function' ? `_c.${name}` : name;
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
  const gen = new Gen(mode, options.scopeAttr, options.hostAttr);

  const ast = parseTemplate(input);
  // isHost: the render fragment's top-level elements are the component's roots → `:host`.
  const render = compileFragment(gen, ast, ctxScope(options.scope ?? []), 'render', 'ctx, slots', false, true);

  if (mode === 'function') {
    const body = [...gen.templates, render, 'return render(ctx, {});'].join('\n');
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
  requireSingleRoot = false,
  isHost = false
): string {
  const top = trimTop(nodes);
  if (top.length === 0) throw new Error('Empty template fragment');
  // A component/slot compiles to a bare `<!---->`, so it can't be the clone root —
  // only a real DOM element qualifies for the single-root (clone) fast path.
  const sole = top.length === 1 && top[0].type === 'element' ? (top[0] as ElementNode) : null;
  const singleRoot = !!sole && !/^[A-Z]/.test(sole.tag) && sole.tag !== 'slot';
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

  function emitChildren(children: TemplateNode[], basePath: number[], sc: Scope, isHost = false): void {
    let dom = 0;
    // Hoist sibling snippet names so any sibling can `@render` them regardless of
    // declaration order (and so a snippet can be passed as a prop / reference another).
    let cur = sc;
    const snippetNames = children.filter((n): n is SnippetNode => n.type === 'snippet').map((n) => n.name);
    if (snippetNames.length) {
      cur = new Map(cur);
      for (const nm of snippetNames) cur.set(nm, { kind: 'local' });
    }
    for (const node of children) {
      if (node.type === 'let') {
        html += '<!---->'; // placeholder slot keeps child indices stable
        stmts.push(`const ${node.name} = ${gen.Hc('computed')}(() => ${rewrite(node.expr, cur).code});`);
        cur = childScope(cur, { [node.name]: node.name });
        dom++;
        continue;
      }
      if (node.type === 'snippet') {
        emitSnippet(node, cur); // a declaration — no DOM position, no index consumed
        continue;
      }
      emitNode(node, [...basePath, dom], cur, isHost);
      dom++;
    }
  }

  function emitSnippet(node: SnippetNode, sc: Scope): void {
    // Compiles to a named function `name(p1, p2) { … return Node }` (hoisted in the
    // render fn, closing over `ctx`); params are bare locals inside the body.
    const bodyScope: Scope = new Map(sc);
    for (const p of node.params) bodyScope.set(p, { kind: 'local' });
    childDecls.push(compileFragment(gen, node.children, bodyScope, node.name, node.params.join(', ')));
  }

  function emitRender(node: RenderNode, path: number[], sc: Scope): void {
    html += '<!---->';
    stmts.push(`${gen.H('mountChild')}(${nodeExpr(path)}, ${rewrite(node.expr, sc).code});`);
  }

  function emitKey(node: KeyNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const contentFn = gen.fn();
    childDecls.push(compileFragment(gen, node.children, sc, contentFn));
    stmts.push(`${gen.H('keyBlock')}(${nodeExpr(path)}, () => ${rewrite(node.expr, sc).code}, ${contentFn});`);
  }

  function emitNode(node: TemplateNode, path: number[], sc: Scope, isHost = false): void {
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
        emitElement(node, path, sc, isHost);
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
      case 'defer':
        emitDefer(node, path, sc);
        return;
      case 'await':
        emitAwait(node, path, sc);
        return;
      case 'render':
        emitRender(node, path, sc);
        return;
      case 'key':
        emitKey(node, path, sc);
        return;
      case 'snippet':
        throw new Error('@snippet is a declaration, handled in emitChildren');
      case 'let':
        throw new Error('@let cannot be a single dynamic node here');
    }
  }

  function emitElement(node: ElementNode, path: number[], sc: Scope, isHost = false): void {
    if (node.tag === 'slot') return emitSlot(node, path, sc);
    if (node.tag === 'w:element') return emitDynamicElement(node, path, sc);
    if (/^[A-Z]/.test(node.tag)) return emitComponent(node, path, sc);
    html += `<${node.tag}`;
    if (gen.scopeAttr) html += ` ${gen.scopeAttr}`; // scoped-CSS marker
    if (isHost && gen.hostAttr) html += ` ${gen.hostAttr}`; // `:host` root marker
    for (const attr of node.attrs) {
      if (attr.type === 'static') {
        html += attr.value === '' ? ` ${attr.name}` : ` ${attr.name}="${escapeAttr(attr.value)}"`;
      } else {
        emitBinding(attr, nodeExpr(path), sc);
      }
    }
    html += '>';
    if (!node.selfClosing) {
      emitChildren(node.children, path, sc);
      html += `</${node.tag}>`;
    }
  }

  /**
   * `<w:element this={tag} …>children</w:element>` — a dynamically-tagged element.
   * Emits a `<!---->` anchor + `dynElement(anchor, () => tag, build)`; `build(_el)`
   * wires the (non-`this`) attributes/bindings/children onto the freshly-created
   * element (re-run whenever the tag changes).
   */
  function emitDynamicElement(node: ElementNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const anchor = nodeExpr(path);
    let tagExpr = '""';
    const build: string[] = [];

    for (const attr of node.attrs) {
      if ((attr.type === 'attr' || attr.type === 'static') && attr.name === 'this') {
        tagExpr = attr.type === 'attr' ? rewrite(attr.expr, sc).code : q(attr.value);
        continue;
      }
      if (attr.type === 'static') {
        build.push(`${gen.H('setAttr')}(_el, ${q(attr.name)}, ${q(attr.value)});`);
      } else {
        emitBinding(attr, '_el', sc, build);
      }
    }

    if (trimTop(node.children).length > 0) {
      const contentFn = gen.fn();
      childDecls.push(compileFragment(gen, node.children, sc, contentFn));
      build.push(`_el.append(${contentFn}());`);
    }

    stmts.push(`${gen.H('dynElement')}(${anchor}, () => ${tagExpr}, (_el) => { ${build.join(' ')} });`);
  }

  // `n` is the target node expression; `sink` collects the statements (defaults to
  // the fragment body, but the dynamic element redirects them into its build fn).
  function emitBinding(
    attr: Exclude<Attr, { type: 'static' }>,
    n: string,
    sc: Scope,
    sink: string[] = stmts
  ): void {
    switch (attr.type) {
      case 'attr': {
        const { code, reactive } = rewrite(attr.expr, sc);
        sink.push(
          reactive
            ? `${gen.H('bindAttr')}(${n}, ${q(attr.name)}, () => ${code});`
            : `${gen.H('setAttr')}(${n}, ${q(attr.name)}, ${code});`
        );
        break;
      }
      case 'prop':
        sink.push(`${gen.H('bindProp')}(${n}, ${q(attr.name)}, () => ${rewrite(attr.expr, sc).code});`);
        break;
      case 'class':
        sink.push(`${gen.H('bindClass')}(${n}, ${q(attr.name)}, () => ${rewrite(attr.expr, sc).code});`);
        break;
      case 'show':
        sink.push(`${gen.H('bindShow')}(${n}, () => ${rewrite(attr.expr, sc).code});`);
        break;
      case 'transition': {
        // transition:fn / in:fn / out:fn → transition(el, fn, params, mode). The
        // params are a snapshot (re-read at play time via the fn); the fn resolves to ctx.
        const fn = rewrite(attr.name, sc).code;
        const params = attr.expr !== undefined ? rewrite(attr.expr, sc).code : 'undefined';
        sink.push(`${gen.H('transition')}(${n}, ${fn}, ${params}, ${q(attr.mode)});`);
        break;
      }
      case 'event': {
        const handler = wrapHandler(attr, sc);
        const opts = eventOpts(attr.modifiers);
        sink.push(`${gen.H('listen')}(${n}, ${q(attr.name)}, ${handler}${opts ? `, ${opts}` : ''});`);
        break;
      }
      case 'ref':
        sink.push(`${gen.H('setRef')}(${rewrite(attr.expr, sc).code}, ${n});`);
        break;
      case 'use': {
        // `use:action={arg}` → applyAction(el, action, arg). The action is the
        // `name` identifier (rewritten against ctx); the arg is evaluated eagerly
        // (a snapshot — pass a getter `={() => sig()}` for reactivity).
        const action = rewrite(attr.name, sc).code;
        sink.push(
          attr.expr !== undefined
            ? `${gen.H('applyAction')}(${n}, ${action}, ${rewrite(attr.expr, sc).code});`
            : `${gen.H('applyAction')}(${n}, ${action});`
        );
        break;
      }
      case 'bind': {
        // bind:value / bind:checked / bind:group → two-way `bindValue`. The
        // expression must resolve to a writable signal (passed by reference, not
        // called): `bind:value={count}` → `bindValue(el, ctx.count, 'value')`.
        const kind = attr.name === 'checked' ? 'checked' : attr.name === 'group' ? 'group' : 'value';
        sink.push(`${gen.H('bindValue')}(${n}, ${rewrite(attr.expr, sc).code}, ${q(kind)});`);
        break;
      }
    }
  }

  function emitComponent(node: ElementNode, path: number[], sc: Scope): void {
    html += '<!---->'; // anchor the component mounts before
    const anchorVar = nodeExpr(path);

    // Props: `x="s"` static, `x={expr}` lazy/reactive getter, `on:evt` → onEvt handler.
    const props: string[] = [];
    for (const attr of node.attrs) {
      switch (attr.type) {
        case 'static':
          props.push(`${propKey(attr.name)}: ${q(attr.value)}`);
          break;
        case 'attr':
          // getter ⇒ the child re-reads through it, so the prop stays reactive
          props.push(`get ${propKey(attr.name)}() { return ${rewrite(attr.expr, sc).code}; }`);
          break;
        case 'event':
          props.push(`${propKey(onProp(attr.name))}: ${rewrite(attr.expr, sc).code}`);
          break;
        default:
          throw new Error(`'${attr.type}' binding on <${node.tag}> is not supported yet (M5: props + on:event only)`);
      }
    }

    // Slots: group children by a static `slot="name"` (default otherwise); strip the attr.
    const groups = new Map<string, TemplateNode[]>();
    for (const child of node.children) {
      let target = child;
      let slotName = 'default';
      if (child.type === 'element') {
        const i = child.attrs.findIndex((a) => a.type === 'static' && a.name === 'slot');
        if (i >= 0) {
          slotName = (child.attrs[i] as StaticAttr).value;
          target = { ...child, attrs: child.attrs.filter((_, k) => k !== i) };
        }
      }
      let arr = groups.get(slotName);
      if (!arr) { arr = []; groups.set(slotName, arr); }
      arr.push(target);
    }

    const slots: string[] = [];
    for (const [name, children] of groups) {
      if (trimTop(children).length === 0) continue; // whitespace-only group → no slot
      const slotFn = gen.fn('_s');
      childDecls.push(compileFragment(gen, children, sc, slotFn));
      slots.push(`${propKey(name)}: ${slotFn}`);
    }

    const propsObj = props.length ? `{ ${props.join(', ')} }` : '{}';
    const slotsObj = slots.length ? `{ ${slots.join(', ')} }` : '{}';
    stmts.push(`${gen.H('mountChild')}(${anchorVar}, ${gen.Comp(node.tag)}(${propsObj}, ${slotsObj}));`);
  }

  function emitSlot(node: ElementNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const anchorVar = nodeExpr(path);
    const nameAttr = node.attrs.find((a) => a.type === 'static' && a.name === 'name');
    const name = nameAttr ? (nameAttr as StaticAttr).value : 'default';

    let fallback = 'null';
    if (trimTop(node.children).length > 0) {
      const fbFn = gen.fn('_f');
      childDecls.push(compileFragment(gen, node.children, sc, fbFn));
      fallback = `${fbFn}()`;
    }
    stmts.push(
      `{ const _sf = slots[${q(name)}]; ${gen.H('mountChild')}(${anchorVar}, _sf ? _sf() : ${fallback}); }`
    );
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

  function emitDefer(node: DeferNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const contentFn = gen.fn();
    childDecls.push(compileFragment(gen, node.children, sc, contentFn));

    let phArg = 'undefined';
    if (node.placeholder && trimTop(node.placeholder).length > 0) {
      const phFn = gen.fn();
      childDecls.push(compileFragment(gen, node.placeholder, sc, phFn));
      phArg = phFn;
    }

    const trig = deferTriggerExpr(node.trigger, sc);
    stmts.push(`${gen.H('deferBlock')}(${nodeExpr(path)}, ${trig}, ${contentFn}, ${phArg});`);
  }

  function emitAwait(node: AwaitNode, path: number[], sc: Scope): void {
    html += '<!---->';
    const anchorVar = nodeExpr(path);
    const source = `() => (${rewrite(node.expr, sc).code})`;

    // each part → a fragment fn; @then/@catch take their alias as a parameter so
    // the resolved value / error resolves to the bare name inside the branch.
    const branchFn = (children: TemplateNode[] | undefined, alias?: string): string => {
      if (!children || trimTop(children).length === 0) return 'undefined';
      const fn = gen.fn();
      // the alias is a real function PARAMETER holding the resolved value/error —
      // a plain local (bare name), not an auto-called accessor like @for/@if.
      const scope: Scope = alias ? new Map(sc).set(alias, { kind: 'local' } as Binding) : sc;
      childDecls.push(compileFragment(gen, children, scope, fn, alias ?? ''));
      return fn;
    };

    const pendingArg = branchFn(node.pending);
    const thenArg = branchFn(node.then?.children, node.then?.alias);
    const catchArg = branchFn(node.catch?.children, node.catch?.alias);
    stmts.push(`${gen.H('awaitBlock')}(${anchorVar}, ${source}, ${pendingArg}, ${thenArg}, ${catchArg});`);
  }

  function deferTriggerExpr(t: DeferTrigger, sc: Scope): string {
    switch (t.kind) {
      case 'when':
        return `{ on: "when", when: () => ${rewrite(t.expr, sc).code} }`;
      case 'timer':
        return `{ on: "timer", ms: ${rewrite(t.ms, sc).code} }`;
      case 'idle':
      case 'viewport':
      case 'interaction':
      case 'hover':
      case 'immediate':
        return `{ on: ${q(t.kind)} }`;
    }
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
  if (singleRoot) emitElement(sole!, [], scope, isHost);
  else emitChildren(top, [], scope, isHost);

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

/** Object-literal key: bare when a valid identifier, quoted otherwise. */
function propKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** `on:select` → `onSelect` (the prop the child receives). */
function onProp(event: string): string {
  return 'on' + event.charAt(0).toUpperCase() + event.slice(1);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
