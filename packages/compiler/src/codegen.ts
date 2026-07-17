/**
 * Weave codegen — turns a template AST into JS that creates DOM once and wires
 * fine-grained signal bindings via the `@weave-framework/runtime/dom` helpers.
 *
 * Static structure becomes hoisted `<template>` strings with `<!---->` comment
 * anchors at dynamic positions; dynamic nodes are reached by compile-time
 * child-index paths. Control-flow blocks compile to `ifBlock`/`eachBlock` calls
 * whose branch/row bodies are nested render functions (so they close over `ctx`
 * and any template locals), keeping every block's effects in its own scope.
 */

import { parseTemplate, VOID } from './parser.js';
import type {
  TemplateNode, ElementNode, InterpNode, Attr, StaticAttr, EventAttr, UseAttr, IfNode, IfBranch, ForNode,
  SwitchNode, DeferNode, DeferTrigger, AwaitNode, SnippetNode, RenderNode, KeyNode,
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
  /**
   * Phase E (E0.2b) opt-in target. When true, DOM event handlers compile to resumable references —
   * `resumableHandler(node, event, siteRef, fn)` from `@weave-framework/runtime/resume` in place of an
   * eager `listen(...)` — so the server-rendered HTML carries `data-won-<event>` markers and no listener
   * is wired until the first interaction (see RFC 0009). Default false → the eager path is byte-for-byte
   * unchanged, and the resume entry is never imported (0 bytes for a plain SPA).
   */
  resumable?: boolean;
  /**
   * Phase E (E1.5) — named-handler resume. `name → inlined body`: for a handler site written as a bare
   * binding (`on:click={{ inc }}`), the emitted `handlers(ctx)` factory uses this body in place of
   * `ctx.inc`, which would be undefined on the client (a function can't cross the snapshot). The caller
   * ({@link compileComponent}) extracts each body from `setup` and rewrites it against ctx, so the result
   * is identical to writing the handler inline. Only entries proven safe are present.
   */
  resumableHandlers?: ReadonlyMap<string, string>;
  /**
   * Phase E (E1.6/E1.11) — `name → rewritten initializer`, in declaration order. Bindings that cannot cross
   * the snapshot but CAN be rebuilt from module scope: a `computed` (no writable surface, yet the template
   * calls it — a resumed `undefined` throws and kills the page) and a value like `createRouter([…])`. These
   * become a `derive(ctx)` the client runs after deserialize and BEFORE adopt. Each assignment is guarded by
   * `if (ctx.x === undefined)`, so a binding that DID survive (a signal with the server's value) is kept.
   */
  resumableDerived?: ReadonlyMap<string, string>;
  /**
   * Phase E (E1.19) — `name → rewritten function`, in declaration order: `setup`'s own helper FUNCTIONS,
   * re-declared as locals of the `handlers(ctx)` factory. A function never crosses the snapshot and `derive`
   * cannot rebuild one, so a handler calling a helper would be refused — but it needs no wire: the factory
   * re-declares it over the resumed ctx, once per instance, exactly as setup's closure held it.
   */
  resumableLocals?: ReadonlyMap<string, string>;
  /**
   * Phase E (E1.47) — `setup`'s bare `effect(…)` statements, ctx-rewritten, in source order. They bind no name,
   * so `resumableDerived` never carried them and a resumed page silently lost them: the docs shell's per-route
   * `document.title` effect stopped tracking, so the title froze at the server's value. `derive` re-runs them
   * after the bindings they read, inside the reactive root that owns the resume, so they dispose with it.
   */
  resumableEffects?: readonly string[];
  /**
   * Phase E (E1.45) — a reason the CALLER already knows this fragment cannot be adopted, even though nothing in
   * the template says so. `compileComponent` uses it for a lifecycle hook registered in `setup`: resume never
   * runs setup, so the hook is never registered and its DOM work never happens. The component still compiles to
   * the resumable target (its server render must stamp the markers its parent's cursor walks) — only adopt is
   * off, and the reason rides out on {@link CompileResult.notAdoptable} like any other.
   */
  cannotAdopt?: string;
}

export interface CompileResult {
  /** The generated code (an ES module in `module` mode, a `new Function` body in `function` mode). */
  code: string;
  /**
   * PascalCase child-component tags the template references (`<Input>` → `"Input"`). In
   * `module` mode these compile to bare identifiers the emitted module must have in scope;
   * the loader resolves each to a real `import` (function mode injects them via `_c` instead).
   */
  components: string[];
  /**
   * Phase E (E1.5) — resumable target only: names of `on:` handler sites that stayed a bare `ctx.<name>`,
   * i.e. the handlers that will be DEAD after resume (the function itself never crosses the snapshot).
   * Empty when every site is inline or was inlined. {@link compileComponent} turns these into build warnings.
   */
  deadHandlers?: string[];
  /**
   * Phase E (E1.14) — resumable target only: why this component's render could NOT be adopted (empty when it
   * can). A non-adoptable render means the ENTIRE component subtree is client-rendered on resume — the single
   * most consequential downgrade in the feature, and until now a completely silent one.
   */
  notAdoptable?: string[];
}

class Gen {
  used: Set<string> = new Set<string>(); // @weave-framework/runtime/dom helpers
  usedCore: Set<string> = new Set<string>(); // @weave-framework/runtime primitives (computed, …)
  /** E1.5 — `name → inlined setup body`; a bare `ctx.<name>` handler ref substitutes through it. */
  inlined?: ReadonlyMap<string, string>;
  /** E1.7 — handler names still emitted as a bare `ctx.<name>`, i.e. DEAD after resume. */
  deadHandlers: string[] = [];
  /**
   * E1.14 — why this fragment cannot be adopted, in the order the walk hit each cause.
   *
   * `adoptable` starts true and is switched off in ~17 places; each was SILENT, so a component whose whole
   * subtree fell back to client rendering said nothing at all — the single most misleading failure in the
   * feature (it made a docs page look resumed when nothing had run). Recording the reason costs nothing —
   * the compiler already knows it — and {@link compileComponent} turns it into a build warning.
   */
  notAdoptable: string[] = [];

  /** Mark this fragment un-adoptable, saying WHY (first cause wins; the rest are noise once it's off). */
  cannotAdopt(reason: string): void {
    if (this.adoptable && !this.notAdoptable.includes(reason)) this.notAdoptable.push(reason);
    this.adoptable = false;
  }
  usedResume: Set<string> = new Set<string>(); // @weave-framework/runtime/resume helpers (resumable target)
  usedAdopt: Set<string> = new Set<string>(); // @weave-framework/runtime/adopt helpers (resumable target)
  usedGraph: Set<string> = new Set<string>(); // @weave-framework/runtime/graph helpers (resumable target)
  usedComponents: Set<string> = new Set<string>(); // PascalCase child tags referenced in module mode
  templates: string[] = [];
  /**
   * Resumable event sites in the ROOT render fragment (E1.1): `ref → handler expr`. The compiler emits a
   * `handlers(ctx)` factory from these so `resume()` wires handlers with no hand-authoring. Only root-fragment
   * sites are collected — a block-local handler (a `@for` row's) closes over locals not in `ctx`, so it needs
   * serialized closure state (a later slice) and is left to the in-render `resumableHandler`.
   */
  resumableSites: Array<{ ref: string; code: string }> = [];
  /** compileFragment nesting depth; 1 == the root render fragment (see {@link resumableSites}). */
  fragmentDepth: number = 0;
  /**
   * E1.2b-2: whether the ROOT fragment is "flat-adoptable" — a single root element carrying only static
   * structure + reactive text/attr bindings + events (no blocks/components/slots, no non-reactive interp,
   * no use|bind|ref|transition). Set false the moment the create walk hits anything the adopt render can't
   * navigate in place yet (those need the marker cursor walk — E1.2c). Gates whether an `adopt(_r, …)`
   * variant is emitted alongside `render`; when false, a resumed page falls back to CSR (unchanged).
   */
  adoptable: boolean = true;
  /**
   * E1.46 — whether `adopt`'s `_r` must be the mount CONTAINER rather than a root element. A single root
   * element IS `_r` (its bindings sit under it); a multi-root / text-root fragment has no such element, so its
   * top-level nodes are the container's children and `_r` is the container itself. Both navigate by
   * `child(_r, i)`, which is exactly why the difference is invisible in the emit — the CALLER has to be told.
   * Rides out as `adopt.container = true` so the client entry can hand `resumePage` the right node.
   */
  rootIsFragment: boolean = false;
  /** E1.21 — the names `derive(ctx)` rebuilds, so a `use:` action can tell whether it resolves on a resume. */
  derived: ReadonlySet<string> = new Set<string>();
  private tplN: number = 0;
  private fnN: number = 0;
  private refN: number = 0;

  constructor(
    public mode: 'module' | 'function',
    public scopeAttr?: string,
    public hostAttr?: string,
    public resumable: boolean = false
  ) {}

  H(name: string): string {
    this.used.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  Hc(name: string): string {
    this.usedCore.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  /** Reference a `@weave-framework/runtime/resume` helper (resumable target only; via `rt.` in function mode). */
  Hr(name: string): string {
    this.usedResume.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  /** Reference a `@weave-framework/runtime/adopt` helper (resumable target only; via `rt.` in function mode). */
  Ha(name: string): string {
    this.usedAdopt.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  /** Reference a `@weave-framework/runtime/graph` helper (resumable target only; via `rt.` in function mode). */
  Hg(name: string): string {
    this.usedGraph.add(name);
    return this.mode === 'function' ? `rt.${name}` : name;
  }
  /** A stable, per-compile component-instance id (`c0`, `c1`, …) — the resume snapshot key for a static child. */
  componentN: number = 0;
  componentId(): string {
    return `c${this.componentN++}`;
  }
  /** A stable, per-compile event-site id (`w0`, `w1`, …) — the resumable handler reference prefix. */
  ref(): string {
    return `w${this.refN++}`;
  }
  /**
   * Reference a child component: from the `_c` map in function mode, bare (imported)
   * in module mode. In module mode the bare identifier must be in the emitted module's
   * scope — the loader resolves each recorded tag to a real `import` (see the plugin's
   * child-import injection), or the component's own `<script>` imports it explicitly.
   */
  Comp(name: string): string {
    this.usedComponents.add(name); // the composed child tags, independent of resolution mode
    return this.mode === 'function' ? `_c.${name}` : name;
  }
  tpl(html: string, svg: boolean = false): string {
    const v: string = `_t${this.tplN++}`;
    this.templates.push(`const ${v} = ${this.H(svg ? 'templateSvg' : 'template')}(${JSON.stringify(html)});`);
    return v;
  }
  fn(prefix: string = '_b'): string {
    return `${prefix}${this.fnN++}`;
  }
}

export function compileTemplate(input: string, options: CompileOptions = {}): CompileResult {
  return compileTemplateAst(parseTemplate(input), options);
}

/**
 * Like {@link compileTemplate} but from an already-parsed AST — used when the AST is
 * transformed before codegen (e.g. RFC 0008 `#3` component-extension template patches
 * splice/patch the base template's AST, then compile the result without a round-trip through
 * template text).
 */
export function compileTemplateAst(ast: TemplateNode[], options: CompileOptions = {}): CompileResult {
  const mode: 'module' | 'function' = options.mode ?? 'module';
  const runtimeImport: string = options.runtimeImport ?? '@weave-framework/runtime/dom';
  const gen: Gen = new Gen(mode, options.scopeAttr, options.hostAttr, options.resumable ?? false);
  gen.derived = new Set(options.resumableDerived?.keys() ?? []);
  if (options.cannotAdopt) gen.cannotAdopt(options.cannotAdopt); // E1.45 — a reason from outside the template

  // E1.2c-6: a resumable component's render self-registers its ctx for the snapshot when the parent tagged
  // this instance with a `$wid` prop (a static-position child) — so the client resumes it without re-running
  // setup. No-op at runtime outside a collectStates() session (client / SPA), and never emitted for eager.
  // Register a PLAIN copy of the component's OWN bindings (`{...ctx}` — the signals setup returned): the ctx
  // itself has props on its prototype (not serializable, and reconnected by the parent), and `$wid` is a prop
  // too, so both are naturally excluded. Reactive props / computeds inside a resumed child are a known gap.
  gen.inlined = options.resumableHandlers;
  const renderPreamble: string = gen.resumable
    ? `if (ctx.$wid !== undefined) ${gen.Hg('registerState')}(ctx.$wid, { ...ctx }, ${JSON.stringify([...(options.resumableDerived?.keys() ?? [])])});`
    : '';
  // isHost: the render fragment's top-level elements are the component's roots → `:host`.
  const render: string = compileFragment(gen, ast, ctxScope(options.scope ?? []), 'render', 'ctx, slots', true, 'create', renderPreamble);
  const components: string[] = [...gen.usedComponents];

  // E1.1 — the resumable target also emits a `handlers(ctx)` factory (root-fragment event sites → handler
  // over the resumed ctx), so `resume()` wires real handlers with no hand-authoring. It rides on `render`
  // as `render.handlers` (function mode) and is a named export (module mode). Empty unless sites exist.
  //
  // E1.5 — a site written as a bare binding (`on:click={{ inc }}`) compiles to `ctx.inc`, which is undefined
  // on the client: a function can't cross the snapshot (registerState drops it). When the caller supplied the
  // handler's inlined body, substitute it — the factory then closes over the resumed signals exactly as an
  // inline handler does. Any site whose code isn't a bare `ctx.<name>` (already inline) is untouched.
  // Sites left as a bare `ctx.<name>` are the ones that will be DEAD after resume — whatever the cause (not
  // extractable, not inlinable, reassigned). `inlineHandler` records them on `gen` so a component-level `on:`
  // (E1.13, handled during the walk) and a DOM site report through ONE list.
  // E1.19 — setup's helper functions, re-declared ahead of the site map so an inlined body can call them.
  const factoryLocals: string = [...(options.resumableLocals ?? [])].map(([n, code]) => `  const ${n} = ${code};\n`).join('');
  // E1.20 — the factory takes `props` too. A handler reading `props` was the LAST root cause: it made a helper
  // like `setOpened` unemittable, so every handler CALLING that helper was refused and blamed the helper. The
  // parent's adopt walk already builds the child's props (getters over the parent's resumed ctx) and hands them
  // to `adoptComponent`; a root has none, so it gets `{}` — which is exactly right, `mountComponent` passes none.
  const handlersFn: string = gen.resumableSites.length
    ? `function handlers(ctx, props) {\n${factoryLocals}  return { ${gen.resumableSites.map((s) => `${q(s.ref)}: ${inlineHandler(gen, s.code)}`).join(', ')} };\n}`
    : '';

  // E1.6 — rebuild each `computed` over the resumed ctx. Emitted in declaration order, so a computed that
  // reads an earlier one sees it already assigned. The client runs this after deserialize, before adopt.
  // Each initializer is emitted verbatim (already ctx-rewritten): its callee is one of the component module's
  // OWN imports (`computed`, `createRouter`, …), which this `derive` sits alongside. The `undefined` guard is
  // what makes it safe to emit for every re-derivable binding — one that DID cross the wire is already on ctx
  // (a signal carrying the server's value) and must not be replaced by a fresh, state-less copy.
  // E1.25 — `derive` takes `props` for the same reason the handlers factory does (E1.20): a binding is very
  // often initialised FROM them (`signal(props.defaultOpened ?? false)`). Giving them to one and not the other
  // made the asymmetry cascade — such a binding was undrivable, so any helper reading it could not be emitted,
  // so every handler calling that helper was refused.
  // E1.27 — the SAME setup helpers the factory declares, because setup was one scope: an initializer very often
  // calls one (`signal(autoMode() ? … : …)`). Declared first; they are arrows, so nothing runs until called.
  // E1.47 — setup's bare `effect(…)`s ride out on `derive` too, AFTER the bindings (an effect reads them) and
  // unguarded: unlike a binding there is nothing on ctx to check, and re-running one is the whole point —
  // it re-subscribes and replays a first pass over the resumed values, which is what the server already did.
  const setupEffects: string = (options.resumableEffects ?? []).map((code) => `\n  ${code};`).join('');
  const setupLocals: string = [...(options.resumableLocals ?? [])].map(([n, code]) => `  const ${n} = ${code};\n`).join('');
  const deriveFn: string = gen.resumable && (options.resumableDerived?.size || setupEffects)
    ? `function derive(ctx, props) {\n${setupLocals}${[...(options.resumableDerived ?? [])]
        .map(([name, code]) => `  if (ctx.${name} === undefined) ctx.${name} = ${code};`)
        .join('\n')}${setupEffects}\n  return ctx;\n}`
    : '';

  // E1.2b-2 — the resumable target ALSO emits an `adopt(_r, ctx, slots)` variant of the render for the
  // FLAT case (single root element, only reactive text/attr bindings + events). It takes the server-rendered
  // root instead of cloning a template, navigates to each dynamic anchor by its SHIFTED server index (the
  // create walk recorded where dynamic-text markers land), and re-binds via `adoptText` in place — events are
  // left to `resume()`'s delegated dispatch. `resume()` runs it to make a resumed page interactive WITHOUT a
  // client re-render (no `setup`). A non-flat fragment emits none → the resumed page falls back to CSR.
  gen.componentN = 0; // reset so the adopt walk assigns the SAME c0,c1,… ids as the create walk (same order)
  const adoptFn: string = gen.resumable && gen.adoptable
    ? compileFragment(gen, ast, ctxScope(options.scope ?? []), 'adopt', 'ctx, slots', true, 'adopt')
    : '';

  if (mode === 'function') {
    const parts: string[] = [...gen.templates, render];
    if (handlersFn) parts.push(handlersFn, 'render.handlers = handlers;');
    if (deriveFn) parts.push(deriveFn, 'render.derive = derive;');
    if (adoptFn) parts.push(adoptFn, 'render.adopt = adopt;', ...adoptRootDecl(gen));
    parts.push('return render(ctx, {});'); // tail unchanged → the function-mode `render` strip still applies
    return { code: parts.join('\n'), components, deadHandlers: gen.deadHandlers };
  }

  const domImport: string = `import { ${[...gen.used].sort().join(', ')} } from ${JSON.stringify(runtimeImport)};`;
  const coreImport: string = gen.usedCore.size
    ? `import { ${[...gen.usedCore].sort().join(', ')} } from "@weave-framework/runtime";\n`
    : '';
  // The resumable target references `@weave-framework/runtime/resume` — a separate entry, so an eager
  // build never imports it (SPA core stays flat; invariant I3). Empty (no line) unless resumable events exist.
  const resumeImport: string = gen.usedResume.size
    ? `import { ${[...gen.usedResume].sort().join(', ')} } from "@weave-framework/runtime/resume";\n`
    : '';
  // Same separate-entry rationale as resume: the adopt helpers live in `@weave-framework/runtime/adopt`, so
  // an eager build never imports them (SPA core stays flat; invariant I3).
  const adoptImport: string = gen.usedAdopt.size
    ? `import { ${[...gen.usedAdopt].sort().join(', ')} } from "@weave-framework/runtime/adopt";\n`
    : '';
  // Same separate-entry rationale: the resume-collection + component-adopt helpers live in runtime/graph.
  const graphImport: string = gen.usedGraph.size
    ? `import { ${[...gen.usedGraph].sort().join(', ')} } from "@weave-framework/runtime/graph";\n`
    : '';
  const imports: string = domImport + '\n' + coreImport + resumeImport + adoptImport + graphImport;

  // With a handlers factory or an adopt variant, emit `render` as a declaration so we can attach + export the
  // extras alongside it; otherwise keep the exact eager shape (`export default function render …`) byte-for-byte.
  if (handlersFn || adoptFn || deriveFn) {
    const code: string = [
      imports,
      ...gen.templates,
      render,
      ...(handlersFn ? [handlersFn, 'render.handlers = handlers;', 'export { handlers };'] : []),
      ...(deriveFn ? [deriveFn, 'render.derive = derive;', 'export { derive };'] : []),
      ...(adoptFn ? [adoptFn, 'render.adopt = adopt;', ...adoptRootDecl(gen), 'export { adopt };'] : []),
      'export default render;',
    ].join('\n');
    return { code, components, deadHandlers: gen.deadHandlers, notAdoptable: gen.notAdoptable };
  }

  const code: string = [imports, ...gen.templates, `export default ${render}`].join('\n');
  return { code, components, deadHandlers: gen.deadHandlers, notAdoptable: gen.notAdoptable };
}

/**
 * SVG-only element tags — those that MUST be created in the SVG namespace and, unlike
 * `<svg>` itself, are not recognised by the HTML parser at the top level of a plain
 * `<template>` (they would become `HTMLUnknownElement`s). A fragment rooted at one of
 * these is parsed via the runtime's `templateSvg` (see codegen `tpl(html, svg)`).
 * `<svg>` is deliberately excluded — the HTML parser handles it correctly on its own,
 * and it can legitimately be the root of a normal (HTML-context) template.
 * Ambiguous tags shared with HTML (`a`, `title`, `style`, `script`) are excluded too.
 */
const SVG_TAGS: Set<string> = new Set<string>([
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'g', 'defs', 'use', 'symbol', 'marker', 'mask', 'pattern', 'clipPath',
  'linearGradient', 'radialGradient', 'stop', 'image', 'foreignObject',
  'text', 'tspan', 'textPath', 'desc', 'view',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDropShadow',
  'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'feSpecularLighting', 'feTile', 'feTurbulence',
  'animate', 'animateMotion', 'animateTransform', 'mpath', 'set',
]);

/** `on:<phase>` names that are transition lifecycle hooks, not DOM events. */
const TRANSITION_PHASES: Set<string> = new Set<string>(['enterstart', 'enterend', 'leavestart', 'leaveend']);

/**
 * A block the adopt walk can island-replay: clear its server DOM + re-run its helper. @if/@switch (E1.2c-2),
 * @for (E1.2c-3), `<slot>` (E1.17 — its content is the PARENT's, rendered by the parent's slot fn, so it
 * replays exactly like a block while the component around it adopts).
 */
function isAdoptableBlock(node: TemplateNode): boolean {
  if (node.type === 'element') return (node as ElementNode).tag === 'slot';
  return node.type === 'if' || node.type === 'switch' || node.type === 'for'
    || node.type === 'key' || node.type === 'render'; // E1.24 — same island-replay shape
}

/** A child component `<Foo/>` — adopt-navigable in place via nested resume (E1.2c-6), not island-replayed. */
function isComponentNode(node: TemplateNode): boolean {
  return node.type === 'element' && /^[A-Z]/.test((node as ElementNode).tag);
}

/** Any control-flow construct that inserts a runtime-variable node count before its anchor (component/slot too). */
function isBlockNode(node: TemplateNode): boolean {
  if (node.type === 'element') {
    const el: ElementNode = node as ElementNode;
    return /^[A-Z]/.test(el.tag) || el.tag === 'slot' || el.tag === 'w:element';
  }
  return node.type === 'if' || node.type === 'for' || node.type === 'switch'
    || node.type === 'defer' || node.type === 'await' || node.type === 'key' || node.type === 'render';
}

/**
 * Whether a node (or any descendant) needs INDEXED DOM access on adopt — i.e. it is anything but pure static
 * structure: an interp, a binding, a control-flow block, or a component/slot. Used to gate block adoptability:
 * once a block's runtime-variable content sits at a level, no such node may FOLLOW it (its server index is
 * unknowable). Pure-static text/elements after a block are fine (nothing navigates to them).
 */
function hasDynamicDeep(node: TemplateNode): boolean {
  switch (node.type) {
    case 'text':
    case 'comment':
      return false;
    case 'element': {
      const el: ElementNode = node as ElementNode;
      if (/^[A-Z]/.test(el.tag) || el.tag === 'slot' || el.tag === 'w:element') return true;
      if (el.attrs.some((a) => a.type !== 'static')) return true;
      return el.children.some(hasDynamicDeep);
    }
    default:
      return true; // interp / if / for / switch / defer / await / key / render / snippet / let
  }
}

/**
 * PascalCase child-component tag → kebab-case module basename (`SlideToggle` → `slide-toggle`).
 * Used by the loader to resolve a `<Foo>` tag to its sibling component module by convention.
 */
export function pascalToKebab(tag: string): string {
  return tag
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Extension-less module specifiers to probe (in order) when resolving a PascalCase
 * child tag to a sibling component module, relative to the parent component's directory.
 * Covers the two canonical layouts: dir-per-component (`../foo/foo`, the ui library) and
 * flat siblings (`./foo`), plus a nested `./foo/foo`. The loader appends a source
 * extension to test existence and `.js` for the emitted import.
 */
export function childImportCandidates(tag: string): string[] {
  const k: string = pascalToKebab(tag);
  return [`../${k}/${k}`, `./${k}`, `./${k}/${k}`];
}

/** Compile a list of nodes into a `function name(param){…}` declaration. */
function compileFragment(
  gen: Gen,
  nodes: TemplateNode[],
  scope: Scope,
  name: string,
  param: string = '',
  isHost: boolean = false,
  variant: 'create' | 'adopt' = 'create',
  preamble: string = ''
): string {
  const top: TemplateNode[] = trimTop(nodes);
  if (top.length === 0) throw new Error('Empty template fragment');
  gen.fragmentDepth++; // 1 == this (root render) fragment; a nested block body compiles at depth ≥ 2
  const adopt: boolean = variant === 'adopt';
  // A component/slot compiles to a bare `<!---->`, so it can't be the clone root —
  // only a real DOM element qualifies for the single-root (clone) fast path. A
  // fragment root (component / multiple roots / text) returns a DocumentFragment;
  // `eachBlock` brackets such a `@for` row with marker comments so the keyed
  // reconciler can still move/remove it as one unit.
  const sole: ElementNode | null = top.length === 1 && top[0].type === 'element' ? (top[0] as ElementNode) : null;
  const singleRoot: boolean = !!sole && !/^[A-Z]/.test(sole.tag) && sole.tag !== 'slot';
  // E1.46 — record the ROOT render's shape (depth 1) so the emit can publish it. `adopt` navigates a
  // multi-root fragment off the mount CONTAINER, and a caller that guesses `firstElementChild` instead
  // walks into the first root's insides and runs off the end of it.
  if (gen.fragmentDepth === 1) gen.rootIsFragment = !singleRoot;
  // Adopt navigation keys off `_r`: for a single root element `_r` IS that element (children under it); for a
  // multi-root / text-root fragment (E1.2c-6a) `_r` is the mount CONTAINER and the top-level nodes are its
  // children — either way `child(_r, i)` reaches them, so both adopt. A component/slot at the root still opts
  // out via emitComponent/emitSlot (nested resume is later).

  let html: string = '';
  const stmts: string[] = [];
  const childDecls: string[] = [];

  // E1.2b-2 — per-parent record of reactive-text child indices (in PRISTINE order). Each such interp inserts
  // a marker + text node (2) before its anchor at render time, so in adopt mode a node's server index is its
  // pristine index shifted by 2 for every dynamic-text sibling at or before it in the same parent.
  const dynText: Map<string, number[]> = new Map<string, number[]>();
  const recordDyn = (basePath: number[], idx: number): void => {
    const k: string = basePath.join(',');
    const arr: number[] | undefined = dynText.get(k);
    if (arr) arr.push(idx);
    else dynText.set(k, [idx]);
  };
  // Server child indices for `path`, levels [start, end) — the block-free adopt navigation. Each preceding
  // dynamic-text sibling at a level adds 2 (its marker+text). `start > 0` computes only a SUFFIX, used when a
  // post-block element rebases its subtree onto a cursor var (E1.2c-5) instead of the fragment root.
  const adoptIndicesFrom = (path: number[], start: number): number[] => {
    const out: number[] = [];
    for (let level: number = start; level < path.length; level++) {
      const parentKey: string = path.slice(0, level).join(',');
      const idx: number = path[level];
      const dyns: number[] | undefined = dynText.get(parentKey);
      let shift: number = 0;
      if (dyns) for (const d of dyns) if (d <= idx) shift += 2; // < shifts it; == is its own marker+text
      out.push(idx + shift);
    }
    return out;
  };

  // Post-block subtree rebasing (E1.2c-5): pathKey → the cursor var holding that node (an element reached via
  // `after(blockEnd, off)`) + its path length, so deeper nodeExpr calls navigate `child(<var>, …suffix)`.
  const nodeOverride: Map<string, NodeOverride> = new Map();
  const findOverride = (path: number[]): NodeOverride | null => {
    for (let len: number = path.length; len >= 1; len--) {
      const e: NodeOverride | undefined = nodeOverride.get(path.slice(0, len).join(','));
      if (e) return e;
    }
    return null;
  };

  // E1.2c-4 post-block cursor state (adopt walk). `blockEndVar` is the var holding the most recent adoptable
  // block's `]` end anchor (set by emitIf/emitFor). When emitChildren is past that block, it sets
  // `curInterpBase`/`curInterpOff` so a following reactive interp binds via `after(], offset)` instead of an
  // (unknowable) absolute child index.
  let blockEndVar: string = '';
  let curInterpBase: string | null = null;
  let curInterpOff: number = 0;

  // Resolve each dynamic node into a local BEFORE any binding runs: a binding
  // inserts nodes, which would shift the child indices later `child()` lookups
  // rely on. Capturing the (stable) node references up front avoids that.
  const nodeDecls: string[] = [];
  const nodeVars: Map<string, string> = new Map<string, string>();
  let nodeVarN: number = 0;
  const nodeExpr = (path: number[]): string => {
    if (path.length === 0) return '_r';
    const key: string = path.join(',');
    let v: string | undefined = nodeVars.get(key);
    if (!v) {
      // Post-block subtree (E1.2c-5): a prefix of `path` is a cursor var → navigate relative to it.
      const ov: NodeOverride | null = adopt ? findOverride(path) : null;
      if (ov) {
        if (path.length === ov.prefixLen) {
          nodeVars.set(key, ov.baseVar);
          return ov.baseVar;
        }
        v = `_n${nodeVarN++}`;
        nodeVars.set(key, v);
        const suffix: number[] = adoptIndicesFrom(path, ov.prefixLen);
        nodeDecls.push(`const ${v} = ${gen.H('child')}(${ov.baseVar}, ${suffix.join(', ')});`);
        return v;
      }
      v = `_n${nodeVarN++}`;
      nodeVars.set(key, v);
      const idxPath: number[] = adopt ? adoptIndicesFrom(path, 0) : path; // adopt walks the SHIFTED server DOM
      nodeDecls.push(`const ${v} = ${gen.H('child')}(_r, ${idxPath.join(', ')});`);
    }
    return v;
  };

  // A control-flow block anchor (E1.2c). Eager: a plain `<!---->`. Resumable: a `]` end anchor plus a runtime
  // `blockStart(anchor)` that inserts the `[` boundary marker before the block's content — so the client cursor
  // can bound + skip the block by bracket-matching. `blockStart` is a stmt (runs after node refs are captured,
  // before the block helper fills content), so refs stay valid. Returns the anchor node expr.
  function blockAnchor(path: number[]): string {
    html += gen.resumable ? '<!--]-->' : '<!---->';
    const a: string = nodeExpr(path);
    if (gen.resumable && !adopt) stmts.push(`${gen.Ha('blockStart')}(${a});`);
    return a;
  }

  // Emit a control-flow block's replay. `mk(anchorVar)` builds the ifBlock/eachBlock call string from the
  // anchor var. Create: the anchor is the block's own `<!---->` (nodeExpr). Adopt (island-replay): compute the
  // `]` end anchor as a NODEDECL (`blockEndOf` on the intact server DOM — so a post-block cursor capture can
  // reference it in the node-capture phase), clear the server island, then replay against `]`. `blockEndVar`
  // is exposed to emitChildren as the post-block cursor base (E1.2c-4/5).
  function emitBlockReplay(path: number[], mk: (anchorVar: string) => string): void {
    if (!adopt) {
      stmts.push(mk(nodeExpr(path)));
      return;
    }
    const blk: string = nodeExpr(path);
    const endVar: string = gen.fn('_e');
    nodeDecls.push(`const ${endVar} = ${gen.Ha('blockEndOf')}(${blk});`);
    blockEndVar = endVar;
    stmts.push(`${gen.Ha('clearBlock')}(${blk}, ${endVar});`);
    stmts.push(mk(endVar));
  }

  function emitChildren(children: TemplateNode[], basePath: number[], sc: Scope, isHost: boolean = false): void {
    let dom: number = 0;
    // Hoist sibling snippet names so any sibling can `@render` them regardless of
    // declaration order (and so a snippet can be passed as a prop / reference another).
    let cur: Scope = sc;
    const snippetNames: string[] = children.filter((n): n is SnippetNode => n.type === 'snippet').map((n) => n.name);
    if (snippetNames.length) {
      cur = new Map(cur);
      for (const nm of snippetNames) cur.set(nm, { kind: 'local' });
    }
    // E1.2c adoptability: a block inserts runtime-variable nodes, so at each level only ONE block is
    // adopt-navigable. A following reactive interp is reachable via the E1.2c-4 post-block cursor; anything
    // else needing indexed access after a block is not (yet). Tracked during the create walk.
    let sawBlock: boolean = false;
    // E1.2c-4 adopt cursor: once past the level's adoptable block, a following reactive interp binds via
    // `after(blockEnd, pbOff)`; pbOff accumulates the server-node count of the siblings between them.
    let pbBase: string | null = null;
    let pbOff: number = 0;
    for (const node of children) {
      if (node.type === 'let') {
        if (!adopt && sawBlock) gen.cannotAdopt('a `@let` after a control-flow block'); // not cursor-handled (rare)
        html += '<!---->'; // placeholder slot keeps child indices stable
        stmts.push(`const ${node.name} = ${gen.Hc('computed')}(() => (${rewrite(node.expr, cur).code}));`);
        cur = childScope(cur, { [node.name]: node.name });
        if (adopt && pbBase) pbOff += 1; // the <!----> placeholder is one server node
        dom++;
        continue;
      }
      if (node.type === 'snippet') {
        // E1.24 — no refusal: a `@snippet` is a DECLARATION. It compiles to a function and emits no node, so it
        // cannot shift any index; the old "not cursor-handled" gate had nothing to handle.
        emitSnippet(node, cur); // a declaration — no DOM position, no index consumed
        continue;
      }
      if (!adopt) {
        // Adoptability after a block. A block's rendered node count is runtime-variable, so NOTHING after it is
        // reachable by an absolute child index — only through the post-block cursor. E1.23: everything a level
        // can hold is now reachable — a reactive interp inline (E1.2c-4), an element's subtree rebased onto a
        // cursor var (E1.2c-5), and a block or component via its own `[` anchor (E1.15). An element that holds
        // its OWN block is fine too: once it is found via the cursor, the block inside it sits at a fixed index
        // at ITS level, and that level runs this same tracker. (`@let`/`@snippet` returned above; text/comment
        // need no navigation.) So no refusal belongs here any more — only the KIND check below.
        if (isBlockNode(node)) {
          // Only the KIND decides: a block island-replays (@if/@switch/@for) and a component nested-resumes, and
          // E1.15 gave both a cursor, so a 2nd one per level is fine. A slot/w:element/@defer/@await/@key/@render
          // has no adopt path at all, at any position.
          if (!(isAdoptableBlock(node) || isComponentNode(node))) gen.cannotAdopt(`\`${describe(node)}\` cannot be adopted in place`);
          sawBlock = true;
        }
      }
      // Post-block cursor setup (adopt walk): a following interp binds via after(], off) inline; a following
      // block-free element with dynamics is captured as a cursor var so its subtree rebases onto it (override).
      curInterpBase = null;
      if (adopt && pbBase) {
        if (node.type === 'interp') {
          curInterpBase = pbBase;
          curInterpOff = pbOff;
        } else if (
          (node.type === 'element' && !isBlockNode(node) && hasDynamicDeep(node))
          // E1.15 — a component or island block AFTER another one. Its `[` start marker sits at
          // `after(prevEnd, off + 1)` exactly like a post-block element, so the same cursor var works: overriding
          // its OWN path makes emitComponent/emitBlockReplay's `nodeExpr(path)` yield the cursor instead of an
          // (unknowable) absolute child index. The decl runs before any stmt, i.e. on the intact server DOM.
          || isComponentNode(node) || isAdoptableBlock(node)
        ) {
          const pv: string = gen.fn('_p');
          nodeDecls.push(`const ${pv} = ${gen.Ha('after')}(${pbBase}, ${pbOff + 1});`);
          nodeOverride.set([...basePath, dom].join(','), { baseVar: pv, prefixLen: basePath.length + 1 });
        }
      }
      emitNode(node, [...basePath, dom], cur, isHost);
      if (adopt) {
        // an island block AND a resumable child component both leave `blockEndVar` = their `]` → the cursor base
        if (isAdoptableBlock(node) || isComponentNode(node)) { pbBase = blockEndVar; pbOff = 0; }
        else if (pbBase) pbOff += node.type === 'interp' ? 3 : 1; // interp = $+text+anchor; else one node
      }
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
    // E1.24 — island-replay, like `@if`/`<slot>`: clear the server copy and re-mount the snippet's output at
    // the `]` anchor. The snippet fn is compiled into THIS fragment and closes over the resumed ctx, so the
    // replay yields the same content, live — while everything around it adopts in place.
    blockAnchor(path);
    emitBlockReplay(path, (a) => `${gen.H('mountChild')}(${a}, ${rewrite(node.expr, sc).code});`);
  }

  function emitKey(node: KeyNode, path: number[], sc: Scope): void {
    blockAnchor(path);
    const contentFn: string = gen.fn();
    childDecls.push(compileFragment(gen, node.children, sc, contentFn));
    // E1.24 — `keyBlock` has the same shape as `ifBlock`: re-run it against the cleared island's `]` anchor.
    emitBlockReplay(path, (a) => `${gen.H('keyBlock')}(${a}, () => ${rewrite(node.expr, sc).code}, ${contentFn});`);
  }

  function emitNode(node: TemplateNode, path: number[], sc: Scope, isHost: boolean = false): void {
    switch (node.type) {
      case 'text':
        html += escapeText(node.value);
        return;
      case 'comment':
        // Comments are dropped at compile time (parseTemplate never emits them here — only the
        // formatter opts in). This no-op keeps the switch total if that ever changes.
        return;
      case 'interp': {
        html += '<!---->';
        const { code, reactive } = rewrite(node.expr, sc);
        if (reactive) {
          // Post-block (E1.2c-4): a reactive interp AFTER a block has no build-time index — walk from the
          // block's `]` end anchor. `after(base, off+3)` is this interp's <!----> anchor (base=], then its
          // $ marker, text, anchor). Emitted inline as a stmt (after the block's replay stmt defines `base`),
          // so NO nodeDecl (which would run before `base` is bound) and no recordDyn (nothing indexes past it).
          if (adopt && curInterpBase) {
            stmts.push(`${gen.Ha('adoptText')}(${gen.Ha('after')}(${curInterpBase}, ${curInterpOff + 3}), () => (${code}));`);
            return;
          }
          // Record this dynamic text's position BEFORE resolving its node expr, so its own marker+text (and
          // any later sibling's adopt-index) are accounted for. The resumable target isolates it with a marker
          // (bindTextResumable) so the client can adopt exactly it (adjacent static+dynamic text would merge);
          // the adopt walk re-binds the EXISTING node via adoptText. Eager is byte-for-byte unchanged.
          recordDyn(path.slice(0, -1), path[path.length - 1]);
          const bind: string = adopt
            ? gen.Ha('adoptText')
            : gen.resumable
              ? gen.Ha('bindTextResumable')
              : gen.H('bindText');
          stmts.push(`${bind}(${nodeExpr(path)}, () => (${code}));`);
        } else {
          // A non-reactive interp sets text once with NO marker → it shifts indices and merges with adjacent
          // static text on the client, so a fragment containing one is not adopt-safe yet (E1.2c). Fall back.
            gen.cannotAdopt(`a NON-reactive interpolation \`{{ ${node.expr.trim()} }}\` — it merges with adjacent static text; call it (\`{{ ${node.expr.trim()}() }}\`) or wrap it in its own element`);
          stmts.push(`${gen.H('setText')}(${nodeExpr(path)}, ${code});`);
        }
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

  function emitElement(node: ElementNode, path: number[], sc: Scope, isHost: boolean = false): void {
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
    } else if (!VOID.has(node.tag)) {
      // A self-closing element that ISN'T an HTML void element — e.g. an SVG `<path/>` /
      // `<circle/>` in foreign content — needs an explicit close tag. Without one the HTML
      // parser leaves it open and nests every following sibling inside it (FW-8).
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
    gen.cannotAdopt('a dynamic `<w:element this={…}>`');
    blockAnchor(path);
    const anchor: string = nodeExpr(path);
    let tagExpr: string = '""';
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
      const contentFn: string = gen.fn();
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
            ? `${gen.H('bindAttr')}(${n}, ${q(attr.name)}, () => (${code}));`
            : `${gen.H('setAttr')}(${n}, ${q(attr.name)}, ${code});`
        );
        break;
      }
      case 'prop':
        sink.push(`${gen.H('bindProp')}(${n}, ${q(attr.name)}, () => (${rewrite(attr.expr, sc).code}));`);
        break;
      case 'class':
        sink.push(`${gen.H('bindClass')}(${n}, ${q(attr.name)}, () => (${rewrite(attr.expr, sc).code}));`);
        break;
      case 'style':
        sink.push(`${gen.H('bindStyleProp')}(${n}, ${q(attr.name)}, () => (${rewrite(attr.expr, sc).code}));`);
        break;
      case 'show':
        sink.push(`${gen.H('bindShow')}(${n}, () => (${rewrite(attr.expr, sc).code}));`);
        break;
      case 'transition': {
        gen.cannotAdopt(`a \`${attr.name}\` transition`); // a lifecycle effect the adopt walk doesn't stage yet
        // transition:fn / in:fn / out:fn → transition(el, fn, params, mode). The
        // params are a snapshot (re-read at play time via the fn); the fn resolves to ctx.
        const fn: string = rewrite(attr.name, sc).code;
        const params: string = attr.expr !== undefined ? rewrite(attr.expr, sc).code : 'undefined';
        sink.push(`${gen.H('transition')}(${n}, ${fn}, ${params}, ${q(attr.mode)});`);
        break;
      }
      case 'event': {
        // The four transition lifecycle moments are not DOM events — route them to the
        // element's transition instead of addEventListener (unchanged in the resumable target too).
        if (TRANSITION_PHASES.has(attr.name)) {
          sink.push(`${gen.H('transitionEvent')}(${n}, ${q(attr.name)}, ${rewrite(attr.expr, sc).code});`);
          break;
        }
        // Adopt (E1.2b-2): DOM events are re-armed by `resume()`'s delegated dispatch off the `data-won-*`
        // markers the server render stamped — the adopt walk must NOT re-wire them here (that's the whole
        // point of resumability). The create walk still records the site + emits the resumable ref below.
        if (adopt) break;
        const handler: string = wrapHandler(attr, sc);
        if (gen.resumable) {
          // Resumable target (E0.2b): emit a handler REFERENCE instead of an eager listener. The runtime
          // helper stamps `data-won-<event>` + registers the handler for a delegated resume dispatch.
          // once/capture/passive don't map onto the delegated path yet, so they're dropped here.
          const ref: string = gen.ref();
          sink.push(`${gen.Hr('resumableHandler')}(${n}, ${q(attr.name)}, ${q(ref)}, ${handler});`);
          // Root-fragment handler → include in the emitted `handlers(ctx)` factory (E1.1). Block-local
          // handlers close over locals absent from `ctx`, so they stay in-render only (deferred slice).
          if (gen.fragmentDepth === 1) gen.resumableSites.push({ ref, code: handler });
          break;
        }
        const opts: string = eventOpts(attr.modifiers);
        sink.push(`${gen.H('listen')}(${n}, ${q(attr.name)}, ${handler}${opts ? `, ${opts}` : ''});`);
        break;
      }
      case 'ref':
        // E1.16 — adoptable: a ref is not state and never can be (a DOM node cannot cross the wire), but adopt
        // does not need it to. `n` already resolves to the ADOPTED node, so the same setRef binds the resumed
        // signal to the element on the page, exactly as the create path binds it to the created one.
        sink.push(`${gen.H('setRef')}(${rewrite(attr.expr, sc).code}, ${n});`);
        break;
      case 'use': {
        // E1.21 — adoptable when the action will EXIST on a resumed client. `use:` never ran on the server at
        // all (`onMount` is inert there), so re-running it against the adopted node is exactly what the create
        // path does, with nothing to double-apply. But an action is a function: it cannot cross the snapshot, so
        // a `ctx.<name>` action resolves only if `derive` rebuilds it (a module import, typically). A plain
        // setup-local action would leave `applyAction` calling `undefined` — refuse the fragment instead.
        if (/^ctx\./.test(rewrite(attr.name, sc).code) && !gen.derived.has(attr.name)) {
          gen.cannotAdopt(`a \`use:${attr.name}\` action`);
        }
        // `use:action={arg}` → applyAction(el, action, () => (arg)). The action is the `name`
        // identifier (rewritten against ctx); the arg is passed as a getter, so a reactive
        // action's `update(arg)` re-runs when it changes (see applyAction / ActionResult).
        // The arg is parenthesized so an object-literal arg (`use:tip={{ {a:1} }}`) is an
        // expression, not a `() => { … }` block.
        const action: string = rewrite(attr.name, sc).code;
        sink.push(
          attr.expr !== undefined
            ? `${gen.H('applyAction')}(${n}, ${action}, () => (${rewrite(attr.expr, sc).code}));`
            : `${gen.H('applyAction')}(${n}, ${action});`
        );
        break;
      }
      case 'bind': {
          gen.cannotAdopt(`a \`bind:${attr.name}\` two-way binding`);
        // bind:value / bind:checked / bind:group → two-way `bindValue`. The
        // expression must resolve to a writable signal (passed by reference, not
        // called): `bind:value={count}` → `bindValue(el, ctx.count, 'value')`.
        const kind: 'checked' | 'group' | 'value' = attr.name === 'checked' ? 'checked' : attr.name === 'group' ? 'group' : 'value';
        sink.push(`${gen.H('bindValue')}(${n}, ${rewrite(attr.expr, sc).code}, ${q(kind)});`);
        break;
      }
    }
  }

  function emitComponent(node: ElementNode, path: number[], sc: Scope): void {
    blockAnchor(path); // anchor the component mounts before (bracketed like a block for the cursor)
    const anchorVar: string = nodeExpr(path);

    // Props: `x="s"` static, `x={expr}` lazy/reactive getter, `on:evt` → onEvt handler.
    // Event handlers are ALSO recorded in a hidden `$events` marker so the runtime forwards
    // ONLY real `on:X` events to the child root — a data-callback prop (`onChange={{…}}`,
    // an `attr`, consumed inside the child) must not be auto-forwarded (double-invoked) too.
    const props: string[] = [];
    const eventKeys: string[] = [];
    const eventProps: Array<{ key: string; code: string }> = []; // E1.13 — re-attached on the adopt path
    const uses: UseAttr[] = []; // `use:` actions forwarded to the mounted component's root element
    for (const attr of node.attrs) {
      switch (attr.type) {
        case 'static':
          // A bare attribute on a component (`<Button disabled>`) is the boolean prop
          // `true`; a quoted `foo="x"` (or explicit empty `foo=""`) stays a string.
          props.push(`${propKey(attr.name)}: ${attr.bare ? 'true' : q(attr.value)}`);
          break;
        case 'attr':
          // getter ⇒ the child re-reads through it, so the prop stays reactive
          props.push(`get ${propKey(attr.name)}() { return ${rewrite(attr.expr, sc).code}; }`);
          break;
        case 'event': {
          const k: string = onProp(attr.name);
          const handlerCode: string = rewrite(attr.expr, sc).code;
          props.push(`${propKey(k)}: ${handlerCode}`);
          eventKeys.push(k);
          eventProps.push({ key: k, code: handlerCode });
          break;
        }
        case 'bind':
          // Two-way on a component = pass the signal itself (by reference, NOT a getter),
          // so the child can read (`prop()`) and write (`prop.set()`). `bind:value={{ x }}`
          // → `value: x` — sugar for the "pass the signal" convention, uniform with elements.
          props.push(`${propKey(attr.name)}: ${rewrite(attr.expr, sc).code}`);
          break;
        case 'use':
          // `use:action` on a component forwards to its single root DOM element (below).
          uses.push(attr);
          break;
        default:
          throw new Error(`'${attr.type}' binding on <${node.tag}> is not supported yet (props, on:event, use:, bind: only)`);
      }
    }
    if (eventKeys.length) props.push(`'$events': [${eventKeys.map((k) => JSON.stringify(k)).join(', ')}]`);

    // E1.2c-6: a STATIC-position (depth-1) resumable component is a resume boundary. Give it a snapshot id;
    // the create mount tags the child with `$wid` (so the child self-registers its ctx) and the adopt walk
    // resumes it in place via adoptComponent. A `use:` component isn't staged for adopt (kills adoptability);
    // a block-nested component (depth ≥ 2) re-renders under its block's island-replay (no id, no adopt).
    const resumableChild: boolean = gen.resumable && gen.fragmentDepth === 1;
    const cid: string = resumableChild ? gen.componentId() : '';
    // E1.22 — a `use:` forwarded onto a component no longer opts the fragment out. Same reasoning as E1.21 (the
    // action never ran on the server, so re-running it on the adopted root is the create path exactly), and the
    // same condition: the action must survive to the client, i.e. `derive` rebuilds a `ctx.<name>` one.
    for (const u of uses) {
      if (/^ctx\./.test(rewrite(u.name, sc).code) && !gen.derived.has(u.name)) {
        gen.cannotAdopt(`a \`use:${u.name}\` action on <${node.tag}>`);
      }
    }
    if (resumableChild && !adopt) props.push(`'$wid': ${q(cid)}`);

    // Slots: group children by a static `slot="name"` (default otherwise); strip the attr.
    const groups: Map<string, TemplateNode[]> = new Map<string, TemplateNode[]>();
    for (const child of node.children) {
      let target: TemplateNode = child;
      let slotName: string = 'default';
      if (child.type === 'element') {
        const i: number = child.attrs.findIndex((a) => a.type === 'static' && a.name === 'slot');
        if (i >= 0) {
          slotName = (child.attrs[i] as StaticAttr).value;
          target = { ...child, attrs: child.attrs.filter((_, k) => k !== i) };
        }
      }
      let arr: TemplateNode[] | undefined = groups.get(slotName);
      if (!arr) { arr = []; groups.set(slotName, arr); }
      arr.push(target);
    }

    const slots: string[] = [];
    for (const [name, children] of groups) {
      if (trimTop(children).length === 0) continue; // whitespace-only group → no slot
      const slotFn: string = gen.fn('_s');
      childDecls.push(compileFragment(gen, children, sc, slotFn));
      slots.push(`${propKey(name)}: ${slotFn}`);
    }

    const propsObj: string = props.length ? `{ ${props.join(', ')} }` : '{}';
    const slotsObj: string = slots.length ? `{ ${slots.join(', ')} }` : '{}';
    const mountExpr: string = `${gen.Comp(node.tag)}(${propsObj}, ${slotsObj})`;

    // Adopt walk: resume the child in place (nested resume) — adoptComponent uses `Comp.adopt` + `states[cid]`,
    // falling back to clear + re-mount (the `mountExpr` thunk) if the child isn't resumable. Capture the child's
    // `]` end anchor as the post-component cursor base (a following sibling reaches over the child's subtree).
    if (adopt && resumableChild) {
      const endVar: string = gen.fn('_e');
      nodeDecls.push(`const ${endVar} = ${gen.Ha('blockEndOf')}(${anchorVar});`);
      blockEndVar = endVar;
      // The mount thunk takes the adopt target and passes it through as `$adopt` (E1.12). A COMPILED child
      // ignores it — it resumes from `states[cid]` instead. A hand-written one (`<RouterView>`) needs live
      // PROPS to adopt (its router), and props only exist inside this thunk — so this is the channel that
      // reaches it, without the router package importing the resume entries (invariant I3).
      const adoptProps: string = [...props, `'$adopt': _a`].join(', ');
      const adoptMount: string = `${gen.Comp(node.tag)}({ ${adoptProps} }, ${slotsObj})`;
      // E1.13 — a component-level `on:` (`<Button on:click={{ toggleTheme }}>`) is NOT a DOM resume site: it
      // compiles to a forwarded `onClick` PROP that `defineComponent` attaches to the child's root while
      // CREATING it. Adopt never runs that path, so the listener would simply be missing (silently — the docs
      // dogfood found the theme button dead). Hand the handlers to `adoptComponent` and it re-attaches them to
      // the adopted root. Inlined, because `ctx.<name>` is undefined on a resumed client.
      const evObj: string = eventProps.length
        ? `{ ${eventProps.map((e) => `${propKey(e.key)}: ${inlineHandler(gen, e.code)}`).join(', ')} }`
        : '';
      // E1.17 — the child's slots must reach its adopt walk (its `<slot>`s replay through these very fns).
      // E1.20 — and its own props, so ITS handlers factory can resolve `props`. Trailing args are positional,
      // so an earlier one that is absent is filled in with `undefined`.
      const tail: string[] = [evObj || 'undefined', slots.length ? slotsObj : 'undefined', propsObj];
      while (tail.length && tail[tail.length - 1] === 'undefined') tail.pop();
      const tailArgs: string = tail.length ? `, ${tail.join(', ')}` : '';
      const call: string = `${gen.Ha('adoptComponent')}(${anchorVar}, ${q(cid)}, ${gen.Comp(node.tag)}, _st, (_a) => ${adoptMount}${tailArgs})`;
      if (uses.length === 0) {
        stmts.push(`${call};`);
        return;
      }
      // E1.22 — forward each `use:` onto the root that is actually on the page. adoptComponent returns it
      // whichever branch produced it (adopted, or rebuilt by the fallback), and `componentRoot` resolves a
      // fragment the same way the create path does.
      const anVar: string = gen.fn('_cn');
      const arVar: string = gen.fn('_cr');
      stmts.push(`const ${anVar} = ${call};`);
      stmts.push(`if (${anVar}) {`);
      stmts.push(`  const ${arVar} = ${gen.H('componentRoot')}(${anVar}, ${q(node.tag)});`);
      for (const u of uses) {
        const action: string = rewrite(u.name, sc).code;
        stmts.push(
          u.expr !== undefined
            ? `  ${gen.H('applyAction')}(${arVar}, ${action}, () => (${rewrite(u.expr, sc).code}));`
            : `  ${gen.H('applyAction')}(${arVar}, ${action});`
        );
      }
      stmts.push(`}`);
      return;
    }

    if (uses.length === 0) {
      stmts.push(`${gen.H('mountChild')}(${anchorVar}, ${mountExpr});`);
      return;
    }

    // `use:` on a component: capture the mounted node, resolve its single root Element
    // (loud error if it renders a fragment/text/nothing), forward each action onto that
    // root through the SAME `applyAction` path elements use, then mount. Order preserved.
    const nodeVar: string = gen.fn('_cn');
    const rootVar: string = gen.fn('_cr');
    stmts.push(`const ${nodeVar} = ${mountExpr};`);
    stmts.push(`const ${rootVar} = ${gen.H('componentRoot')}(${nodeVar}, ${q(node.tag)});`);
    for (const u of uses) {
      const action: string = rewrite(u.name, sc).code;
      stmts.push(
        u.expr !== undefined
          ? `${gen.H('applyAction')}(${rootVar}, ${action}, () => (${rewrite(u.expr, sc).code}));`
          : `${gen.H('applyAction')}(${rootVar}, ${action});`
      );
    }
    stmts.push(`${gen.H('mountChild')}(${anchorVar}, ${nodeVar});`);
  }

  function emitSlot(node: ElementNode, path: number[], sc: Scope): void {
    blockAnchor(path);
    const nameAttr: Attr | undefined = node.attrs.find((a) => a.type === 'static' && a.name === 'name');
    const name: string = nameAttr ? (nameAttr as StaticAttr).value : 'default';

    let fallback: string = 'null';
    if (trimTop(node.children).length > 0) {
      const fbFn: string = gen.fn('_f');
      childDecls.push(compileFragment(gen, node.children, sc, fbFn));
      fallback = `${fbFn}()`;
    }
    // E1.17 — island-replay on adopt. The projected nodes are the PARENT's: it owns their content and their
    // reactivity, and its own resumed ctx already drives the slot fn — so clearing the server copy and
    // re-running `_sf()` yields identical, live content, while the component AROUND the slot adopts in place
    // (previously the whole component fell back to CSR and lost its own state). Slot fns reach the adopt walk
    // because the parent hands them to `adoptComponent`.
    emitBlockReplay(path, (a) => `{ const _sf = slots[${q(name)}]; ${gen.H('mountChild')}(${a}, _sf ? _sf() : ${fallback}); }`);
  }

  function emitIf(node: IfNode, path: number[], sc: Scope): void {
    // E1.2c-2: @if is adopt-navigable (island-replay) when positioned adoptably — the emitChildren tracker
    // decides; no blanket opt-out here. In adopt mode the anchor expr resolves to the block's `[` marker,
    // and `adoptIsland` clears the server branch + returns the `]` for `ifBlock` to repopulate reactively.
    blockAnchor(path);
    const head: IfBranch = node.branches[0];
    let aliasVar: string | undefined;
    if (head.alias) {
      aliasVar = gen.fn('_a');
      stmts.push(`const ${aliasVar} = ${gen.Hc('computed')}(() => ${rewrite(head.cond ?? 'undefined', sc).code});`);
    }

    const branchNames: string[] = node.branches.map(() => gen.fn());
    node.branches.forEach((br, i) => {
      const bScope: Scope = i === 0 && head.alias && aliasVar
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
    const hasElse: boolean = node.branches[node.branches.length - 1].cond === undefined;
    if (!hasElse) lines.push('return null;');

    emitBlockReplay(path, (a) => `${gen.H('ifBlock')}(${a}, () => { ${lines.join(' ')} })`);
  }

  function emitSwitch(node: SwitchNode, path: number[], sc: Scope): void {
    blockAnchor(path); // adopt-navigable like @if (island-replay); emitChildren gates positional adoptability
    const names: string[] = node.cases.map(() => gen.fn());
    node.cases.forEach((c, i) => childDecls.push(compileFragment(gen, c.children, sc, names[i])));

    const lines: string[] = [`const _v = ${rewrite(node.expr, sc).code};`];
    node.cases.forEach((c, i) => {
      if (c.test !== undefined) lines.push(`if (_v === ${rewrite(c.test, sc).code}) return ${names[i]};`);
      else lines.push(`return ${names[i]};`);
    });
    if (!node.cases.some((c) => c.test === undefined)) lines.push('return null;');

    emitBlockReplay(path, (a) => `${gen.H('ifBlock')}(${a}, () => { ${lines.join(' ')} })`);
  }

  function emitDefer(node: DeferNode, path: number[], sc: Scope): void {
    gen.cannotAdopt('an `@defer` block');
    blockAnchor(path);
    const contentFn: string = gen.fn();
    childDecls.push(compileFragment(gen, node.children, sc, contentFn));

    let phArg: string = 'undefined';
    if (node.placeholder && trimTop(node.placeholder).length > 0) {
      const phFn: string = gen.fn();
      childDecls.push(compileFragment(gen, node.placeholder, sc, phFn));
      phArg = phFn;
    }

    const trig: string = deferTriggerExpr(node.trigger, sc);
    stmts.push(`${gen.H('deferBlock')}(${nodeExpr(path)}, ${trig}, ${contentFn}, ${phArg});`);
  }

  function emitAwait(node: AwaitNode, path: number[], sc: Scope): void {
    gen.cannotAdopt('an `@await` block');
    blockAnchor(path);
    const anchorVar: string = nodeExpr(path);
    const source: string = `() => (${rewrite(node.expr, sc).code})`;

    // each part → a fragment fn; @then/@catch take their alias as a parameter so
    // the resolved value / error resolves to the bare name inside the branch.
    const branchFn = (children: TemplateNode[] | undefined, alias?: string): string => {
      if (!children || trimTop(children).length === 0) return 'undefined';
      const fn: string = gen.fn();
      // the alias is a real function PARAMETER holding the resolved value/error —
      // a plain local (bare name), not an auto-called accessor like @for/@if.
      const scope: Scope = alias ? new Map(sc).set(alias, { kind: 'local' } as Binding) : sc;
      childDecls.push(compileFragment(gen, children, scope, fn, alias ?? ''));
      return fn;
    };

    const pendingArg: string = branchFn(node.pending);
    const thenArg: string = branchFn(node.then?.children, node.then?.alias);
    const catchArg: string = branchFn(node.catch?.children, node.catch?.alias);
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
    // E1.2c-3: @for island-replays like @if — adopt clears the server rows + re-runs eachBlock (fresh reactive
    // rows). Positional adoptability is gated by emitChildren (≤1 block/level, nothing indexed after it).
    blockAnchor(path);
    const rowFn: string = gen.fn();
    const forScope: Scope = childScope(sc, {
      [node.item]: '_row.item',
      $index: '_row.index',
      $count: '_row.count',
      $first: '_row.first',
      $last: '_row.last',
      $even: '_row.even',
      $odd: '_row.odd',
    });
    childDecls.push(compileFragment(gen, node.children, forScope, rowFn, '_row'));

    let emptyArg: string = '';
    if (node.empty) {
      const emptyFn: string = gen.fn();
      childDecls.push(compileFragment(gen, node.empty, sc, emptyFn));
      emptyArg = `, ${emptyFn}`;
    }

    const list: string = rewrite(node.list, sc).code;
    const track: string = node.track ? rewrite(node.track, sc).code : '$index';
    const keyFn: string = `(${node.item}, $index) => ${track}`;
    emitBlockReplay(path, (a) => `${gen.H('eachBlock')}(${a}, () => ${list}, ${keyFn}, ${rowFn}${emptyArg})`);
  }

  // walk
  if (singleRoot) emitElement(sole!, [], scope, isHost);
  else emitChildren(top, [], scope, isHost);

  // Adopt variant (E1.2b-2 / E1.2c): no template + no clone — the server-rendered root is passed in as `_r`.
  // Bindings re-attach in place (adoptText / bind*), navigating the SHIFTED server indices computed above; an
  // adoptable @if/@switch island-replays via `adoptIsland` + `ifBlock`, so its branch fns ride in childDecls.
  if (adopt) {
    gen.fragmentDepth--;
    // `_st` is the resume states map (E1.2c-6) — threaded so a child component's adoptComponent can look up its
    // ctx by id and pass it on to the child's own nested children. Undefined for a fragment with no components.
    const sig: string = param ? `_r, ${param}, _st` : '_r, _st';
    const b: string[] = [...nodeDecls, ...stmts, 'return _r;', ...childDecls];
    return `function ${name}(${sig}) {\n${b.map((l) => '  ' + l).join('\n')}\n}`;
  }

  // A fragment whose top-level element(s) are SVG-only tags (a `@for` row / `@if`
  // branch / component root of `<path>`, `<g>`, …) must be parsed in the SVG
  // namespace, else the HTML parser makes an inert `HTMLUnknownElement`. `<svg>` at
  // the top parses correctly on its own, so it isn't in SVG_TAGS → no wrapping.
  const topEls: ElementNode[] = top.filter((n): n is ElementNode => n.type === 'element');
  const svgRoot: boolean = topEls.length > 0 && SVG_TAGS.has(topEls[0].tag);

  const ctor: string = singleRoot ? gen.H('clone') : gen.H('cloneFragment');
  const tplVar: string = gen.tpl(html, svgRoot);
  const body: string[] = [
    ...(preamble ? [preamble] : []), // E1.2c-6: a resumable render self-registers its ctx if the parent tagged it
    `const _r = ${ctor}(${tplVar});`,
    ...nodeDecls,
    ...stmts,
    'return _r;',
    ...childDecls,
  ];
  gen.fragmentDepth--;
  return `function ${name}(${param}) {\n${body.map((l) => '  ' + l).join('\n')}\n}`;
}

/**
 * E1.2c-5 — where a post-block subtree's adopt cursor lives: the var holding a node reached via
 * `after(blockEnd, off)`, plus the path length it covers, so deeper nodes navigate `child(<baseVar>, …suffix)`
 * instead of an absolute child index (which a runtime-variable block makes meaningless).
 */
interface NodeOverride {
  baseVar: string;
  prefixLen: number;
}

/* ──────────── helpers ──────────── */

/**
 * E1.46 — publish `adopt`'s root contract when (and only when) it is the non-obvious one. A multi-root /
 * text-root fragment adopts off the mount CONTAINER; a single root element adopts off itself. Emitted onto
 * the adopt fn so it rides through `_wc.adopt = render.adopt` to the client entry with no extra plumbing.
 */
function adoptRootDecl(gen: Gen): string[] {
  return gen.rootIsFragment ? ['adopt.container = true;'] : [];
}

function wrapHandler(attr: EventAttr, scope: Scope): string {
  const expr: string = rewrite(attr.expr, scope).code;
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

/** Name a node the way its author wrote it (`<RouterView>`, `@for`), so a diagnostic points at real source. */
function describe(node: TemplateNode): string {
  switch (node.type) {
    case 'element':
      return `<${(node as ElementNode).tag}>`;
    case 'interp':
      return `{{ ${(node as InterpNode).expr.trim()} }}`;
    case 'if':
    case 'for':
    case 'switch':
    case 'defer':
    case 'await':
    case 'key':
    case 'let':
    case 'snippet':
    case 'render':
      return `@${node.type}`;
    default:
      return node.type;
  }
}

/**
 * Substitute a bare `ctx.<name>` handler reference with the inlined body of that `setup` handler (E1.5).
 * `ctx.<name>` is `undefined` on a resumed client — functions never cross the snapshot — so a site left as-is
 * is DEAD; record it (E1.7) so the caller can warn. An already-inline expression is returned untouched.
 */
function inlineHandler(gen: Gen, code: string): string {
  const bare: RegExpExecArray | null = /^ctx\.([A-Za-z_$][\w$]*)$/.exec(code);
  if (!bare) return code;
  const body: string | undefined = gen.inlined?.get(bare[1]);
  if (body) return body;
  if (!gen.deadHandlers.includes(bare[1])) gen.deadHandlers.push(bare[1]);
  return code;
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
