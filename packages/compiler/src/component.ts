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

import { compileTemplate, compileTemplateAst, type CompileResult } from './codegen.js';
import { parseTemplate } from './parser.js';
import type { TemplateNode } from './ast.js';
import { applyPatches, type PatchOp } from './patch.js';
import { inferCtxNames } from './infer.js';
import { injectAutoReturn } from './auto-return.js';
import { extractSetupBindings, extractReturnedNames, extractModuleImports, unresolvedRefs, type SetupBindings } from './handlers.js';
import { rewrite, ctxScope } from './scope.js';
import { scopeCss, scopeAttr, hostAttr, hashCss } from './css.js';

export interface ComponentSource {
  /** Setup module — user imports + `export function setup(props) { … return bindings }`. */
  script?: string;
  /** Template markup. For a `#3` component-extension, this is the BASE template `patches` apply to. */
  template: string;
  /**
   * RFC 0008 `#3` — declarative patch ops applied to `template` (the base template) before codegen.
   * Present only for a component-file extension that patches its base rather than overriding it (#1).
   */
  patches?: PatchOp[];
  /** Component CSS (scoped to this component). */
  styles?: string;
}

export interface ComponentOptions {
  /** Shared scope hash; defaults to a hash of `filename` (else the template). */
  hash?: string;
  /** Resolved component path — used for the default hash and debugging. */
  filename?: string;
  /**
   * Phase E resumable build (E1.2c-6). Compiles the template in the `resumable` target (marker-isolated text,
   * `data-won-*` events, an `adopt` variant) and attaches `render.adopt` to the component so a parent can
   * resume this child in place via `adoptComponent`. Default false → the eager module is byte-for-byte.
   */
  resumable?: boolean;
}

export interface CompiledComponent {
  /** The component ES module. */
  code: string;
  /** Scoped CSS — the esbuild plugin collects these into one stylesheet. */
  css: string;
  /** The scope hash both halves share. */
  hash: string;
  /**
   * PascalCase child-component tags this component's template composes (`<Input>` →
   * `"Input"`). The loader resolves each to a real `import` prepended to `code`, unless
   * the component's own script already imports that name (see the plugin).
   */
  components: string[];
  /**
   * Phase E (E1.5/E1.6) — non-fatal build diagnostics, raised ONLY for a `resumable` build. Each names a
   * handler or computed that will not survive resume and says why, so a silent runtime defect (a dead button,
   * or a resume that throws) becomes a message at build time. The loader surfaces these as esbuild warnings.
   * Empty for an eager build.
   */
  warnings?: string[];
}

const HAS_SETUP: RegExp = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;
/** A component-file EXTENSION declares `export const extend = Base` (RFC 0008, form A / mode #1). */
const HAS_EXTEND: RegExp = /export\s+(?:const|let|var)\s+extend\b/;
/** Optional `export function extendProps(props)` — the pre-base props seam (RFC 0008). */
const HAS_EXTEND_PROPS: RegExp = /export\s+(?:async\s+)?function\s+extendProps\b|export\s+(?:const|let|var)\s+extendProps\b/;
/** Optional `export const propDefaults = { … }` — static prop defaults layered under props. */
const HAS_PROP_DEFAULTS: RegExp = /export\s+(?:const|let|var)\s+propDefaults\b/;

/**
 * E1.5 — named-handler resume. Build the `name → inlined body` map the codegen substitutes into the
 * `handlers(ctx)` factory, so `on:click={{ inc }}` resumes exactly like an inline handler.
 *
 * A handler is inlined ONLY when every free identifier in its body still exists on the resumed client. That
 * set is the template's ctx names MINUS every function-valued binding: `registerState` drops functions from
 * the snapshot (they can't serialize), so a body that calls another handler or reads a computed would throw a
 * ReferenceError on the first click. Refusing leaves the site as `ctx.<name>` — today's inert-but-safe
 * behaviour — rather than trading a dead button for a crash. Recursion is fine (the factory binds the name).
 */
function resumableSetup(script: string, scope: string[]): {
  handlers: ReadonlyMap<string, string>;
  computeds: ReadonlyMap<string, string>;
  /** E1.19 — setup's own helper functions, re-declared inside the `handlers(ctx)` factory. */
  locals: ReadonlyMap<string, string>;
  /** Why a binding was refused, keyed by name — the caller turns these into build warnings. */
  reasons: Map<string, string>;
  warnings: string[];
} {
  const handlers: Map<string, string> = new Map();
  const computeds: Map<string, string> = new Map();
  const locals: Map<string, string> = new Map();
  const reasons: Map<string, string> = new Map();
  const warnings: string[] = [];
  const found: SetupBindings = extractSetupBindings(script);
  if (found.handlers.size === 0 && found.computeds.size === 0) return { handlers, computeds, locals, reasons, warnings };

  // The ctx names available on the resumed client = the template scope PLUS any signal/data that setup RETURNS
  // but the template never references (mutated only by a handler, shown only via a computed) — it's serialized
  // regardless, so it resolves. Without it, such a handler is wrongly refused and any warning blames a name
  // that is actually fine. A function (handler/computed) doesn't survive, so it's not added here.
  const returned: Set<string> | null = extractReturnedNames(script);
  const ctxNames: Set<string> = new Set(scope);
  if (returned) for (const n of returned) if (!found.handlers.has(n) && !found.computeds.has(n)) ctxNames.add(n);
  const sc = ctxScope(ctxNames);

  // A re-derived initializer is emitted into THIS module, so it may also reference the module's own imports
  // (`createRouter`, `computed`, `Home`) — they resolve on the client without crossing the wire.
  const imports: Set<string> = extractModuleImports(script);

  // What an inlined body may reference: the bindings that survive to the client. Signals + plain data do
  // (the snapshot carries them); handlers and computeds do NOT — `registerState` drops every function. A
  // computed comes BACK via `derive`, so once we prove one derivable it becomes resolvable for the rest.
  const resolvable: Set<string> = new Set(ctxNames);

  // A RETURNED name that setup never declared but that resolves at module scope — `import { router } from
  // './router'; … return { router }`, a module-level singleton handed straight out (the docs shell's shape,
  // and the reason its root was still dropped). The client has it already, so derive it as ITSELF: no rewrite,
  // it is a module reference, not a ctx one. Same for an imported helper function (dropped from the snapshot
  // like any function, then rebuilt here). First, so a computed or handler below may read it.
  if (returned) {
    for (const n of returned) {
      if (found.handlers.has(n) || found.computeds.has(n) || !imports.has(n)) continue;
      computeds.set(n, n);
      resolvable.add(n);
      sc.set(n, { kind: 'ctx' });
    }
  }

  // Computeds first, in declaration order: each may read the signals plus any earlier computed. `derive`
  // emits them in this same order, so the assignment order matches the dependency order.
  for (const [name, derivable] of found.computeds) {
    const missing: string[] = unresolvedRefs(derivable.source, union(resolvable, imports), [], name);
    if (missing.length) {
      reasons.set(name, blame(missing));
      // A computed the template CALLS and we cannot rebuild makes resume THROW — the whole page dies, so
      // this is worth saying loudly even though we can't tell here whether the template reads it.
      if (scope.includes(name)) {
        warnings.push(
          `computed \`${name}\` cannot be rebuilt on resume — it reads ${blame(missing)}. ` +
            `Resuming this page will fail (\`ctx.${name} is not a function\`). Return ${listOf(missing)} from setup(), or inline the expression.`
        );
      }
      continue;
    }
    computeds.set(name, rewrite(derivable.source, sc).code);
    resolvable.add(name); // now live in the resumed ctx → a later computed / a handler may use it
    sc.set(name, { kind: 'ctx' }); // …and its refs must rewrite to `ctx.<name>` even if the template never reads it
  }

  // E1.19 — setup's own FUNCTIONS, re-declared as locals of the `handlers(ctx)` factory. A function is dropped
  // from the snapshot and `derive` never rebuilds one, so a handler calling a helper used to be refused — the
  // commonest real cause left on the docs site (`setOpened`, `openPanel`, `rovingIndex`). But a helper need not
  // cross the wire: the factory can re-declare it over the resumed ctx exactly as it inlines a handler body,
  // and it is built once per instance, so the locals are shared by every site just as setup's closure was.
  // They stay OUT of `sc`: a reference must rewrite to the bare factory local, not to `ctx.<name>`.
  // Fixed point, because helpers may be mutually recursive — declaration order alone would refuse one.
  const emittable: Set<string> = new Set(resolvable);
  // E1.20 — `props` resolves inside the factory: it is its second parameter, fed by the parent's adopt emit
  // (a root gets `{}`, which is what `mountComponent` gives it too). It stays OUT of `sc`, so a reference
  // rewrites to the bare parameter rather than `ctx.props`.
  emittable.add('props');
  for (const name of found.handlers.keys()) emittable.add(name); // assume all, then withdraw what cannot resolve
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of found.handlers) {
      if (!emittable.has(name)) continue;
      if (unresolvedRefs(fn.source, union(emittable, imports), fn.params, name).length === 0) continue;
      emittable.delete(name);
      changed = true;
    }
  }
  // Declaration order: setup ran in it, so a helper's own dependencies are already bound by the time it is
  // called. (A `const` TDZ only bites on a call during the factory body, which never happens — all sites are
  // arrows invoked later.)
  for (const [name, fn] of found.handlers) {
    if (emittable.has(name)) locals.set(name, rewrite(fn.source, sc).code);
  }

  // Handlers last — so a handler may read a derived computed (`() => count.set(doubled())`) AND call a helper.
  for (const [name, handler] of found.handlers) {
    if (!scope.includes(name)) continue; // the template never references it
    const missing: string[] = unresolvedRefs(handler.source, union(emittable, imports), handler.params, name);
    if (missing.length) {
      reasons.set(name, blame(missing));
      continue; // the warning is raised by the caller, which knows whether it is actually a handler SITE
    }
    handlers.set(name, rewrite(handler.source, sc).code);
  }
  return { handlers, computeds, locals, reasons, warnings };
}

/** The union of two name sets (what a re-derived initializer may reference). */
function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out: Set<string> = new Set(a);
  for (const n of b) out.add(n);
  return out;
}

/** `['step']` → "`step`, which setup() does not return"; two or more → a list. */
function blame(missing: string[]): string {
  return `${listOf(missing)}, which setup() does not return`;
}

function listOf(names: string[]): string {
  return names.map((n) => `\`${n}\``).join(', ');
}

/** Compile a `{ script, template, styles }` triple into a component module + scoped CSS. */
export function compileComponent(src: ComponentSource, opts: ComponentOptions = {}): CompiledComponent {
  const hash: string = opts.hash ?? hashCss(opts.filename ?? src.template);
  const attr: string = scopeAttr(hash);

  // Parse once; a `#3` extension patches the base template's AST before scope-inference + codegen.
  let ast: TemplateNode[] = parseTemplate(src.template);
  if (src.patches?.length) ast = applyPatches(ast, src.patches);
  const scope: string[] = inferCtxNames(ast);
  // Stamp the `:host` root marker only when the styles actually use `:host` (else zero cost).
  const host: string | undefined = src.styles && /:host\b/.test(src.styles) ? hostAttr(hash) : undefined;
  // E1.5/E1.6 — resumable only: inline each named handler's `setup` body (`on:click={{ inc }}`) and re-derive
  // each `computed` over the resumed ctx (`{{ doubled() }}`), neither of which can cross the snapshot.
  const resumed = opts.resumable && src.script ? resumableSetup(src.script, scope) : undefined;
  const compiled: CompileResult = compileTemplateAst(ast, {
    mode: 'module',
    scope,
    scopeAttr: attr,
    hostAttr: host,
    resumable: opts.resumable,
    resumableHandlers: resumed?.handlers,
    resumableDerived: resumed?.computeds,
    resumableLocals: resumed?.locals,
  });
  // Demote the template module's default export to a local `render` we can wire up:
  //  - eager:     `export default function render …`  → `function render …`
  //  - resumable: `render` is already a `function render` declaration; a trailing `export default render;`
  //    (emitted alongside `export { handlers }` / `export { adopt }`) is stripped — the component's default
  //    export is `defineComponent(...)`, and `render.adopt` is attached to it below.
  const renderBody: string = compiled.code
    .replace('export default function render', 'function render')
    .replace(/\n?export default render;?\s*$/, '');

  const css: string = src.styles ? scopeCss(src.styles, hash) : '';
  const script: string = src.script ?? '';
  const hasSetup: boolean = HAS_SETUP.test(script);
  // Auto-expose: when `setup` omits its `return`, synthesize one exposing exactly the
  // names the template reads (`scope`). A setup that already returns is left untouched.
  const exposed: string = hasSetup ? injectAutoReturn(script, scope).code : script;

  // A component-file EXTENSION (`export const extend = Base`, RFC 0008): the default export wraps
  // its own setup with the base's via `extendSetup(extend, setup?, extendProps?)`, so an instance
  // reuses the base's setup context and this component's `setup(props, base)` overrides/adds on top.
  // Its own template is the full override (mode #1). A non-extension component is unchanged.
  const isExtension: boolean = HAS_EXTEND.test(script);
  let defineExpr: string;
  let extendImport: string = '';
  if (isExtension) {
    const args: string[] = ['extend', hasSetup ? 'setup' : 'undefined'];
    if (HAS_EXTEND_PROPS.test(script)) args.push('extendProps');
    defineExpr = `defineComponent(render, extendSetup(${args.join(', ')}))`;
    extendImport = ', extendSetup';
  } else {
    // `export const propDefaults` → pass it as the 3rd arg (defineComponent layers it under props).
    const parts: string[] = ['render'];
    if (hasSetup) parts.push('setup');
    if (HAS_PROP_DEFAULTS.test(script)) {
      if (!hasSetup) parts.push('undefined');
      parts.push('propDefaults');
    }
    defineExpr = `defineComponent(${parts.join(', ')})`;
  }
  // Resumable: attach the render's `adopt` + `handlers` + `derive` to the component so a parent
  // (adoptComponent reads `Comp.adopt`/`Comp.derive`) and the client resume entry (`resumePage({ adopt:
  // Root.adopt, handlers: Root.handlers, derive: Root.derive })`) reach them off the component itself. Each
  // is undefined for a render with no adopt / no events / no computeds → harmless.
  const defaultExport: string = opts.resumable
    ? `const _wc = ${defineExpr};\n_wc.adopt = render.adopt;\n_wc.handlers = render.handlers;\n_wc.derive = render.derive;\nexport default _wc;`
    : `export default ${defineExpr};`;

  const code: string = [
    exposed.trim(),
    `import { defineComponent${extendImport} } from "@weave-framework/runtime/dom";`,
    renderBody,
    defaultExport,
  ]
    .filter(Boolean)
    .join('\n\n');

  // E1.5/E1.6 — a resumable build reports what will NOT survive resume. A dead handler site is ground truth
  // from the codegen (whatever the cause); the reason comes from the extraction when it knows one.
  const warnings: string[] = resumed ? [...resumed.warnings] : [];
  // E1.14 — the big one: a render that cannot be adopted means this component's WHOLE subtree is re-rendered
  // on the client (its setup re-runs; nothing below it resumes). It used to be entirely silent, which is what
  // made a docs page look resumed when nothing had run at all.
  if (opts.resumable && compiled.notAdoptable?.length) {
    warnings.push(
      `this component cannot be resumed — its template uses ${compiled.notAdoptable.join('; and ')}. ` +
        `The whole subtree will be client-rendered instead (setup re-runs). Remove or move that construct to ` +
        `make the component adoptable.`
    );
  }
  for (const name of compiled.deadHandlers ?? []) {
    const why: string | undefined = resumed?.reasons.get(name);
    warnings.push(
      `handler \`${name}\` will not work after resume — ` +
        (why
          ? `it reads ${why}. Return it from setup(), or inline the handler in the template.`
          : `its definition could not be read from setup() (only a plain \`const ${name} = () => …\` / \`function ${name}() {}\` is understood). ` +
            `Inline the handler in the template to make it resumable.`)
    );
  }

  return { code, css, hash, components: compiled.components, ...(warnings.length ? { warnings } : {}) };
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
