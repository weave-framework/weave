/**
 * Virtual `.ts` generation — the heart of M8, shared by `weave check` and the
 * M9 language server.
 *
 * For each component we synthesize a never-bundled TypeScript module: the user's
 * verbatim `setup` script, followed by a `__weave__()` harness that places every
 * template expression in a type-checked position against `ReturnType<typeof
 * setup>` (exposed as `__ctx`). Template locals (`@for` item + `$index`…, `@let`,
 * `@if … as x`) become real lexical bindings, so TypeScript scopes and narrows
 * them exactly as the runtime does.
 *
 * Two source maps come out of the same emit:
 *  - `templateMap` (line → source offset) — what `weave check` uses to translate a
 *    `tsc` diagnostic line back to a `.weave`/`.html` line:col.
 *  - `mappings` (char-precise verbatim runs) — what the Volar language server uses
 *    to drive hover / go-to-definition / rename and to surface diagnostics at the
 *    exact template span. Built from `rewrite`'s segment maps.
 */

import {
  parseTemplate,
  parseSfcLoc,
  inferCtxNames,
  injectAutoReturn,
  applyPatches,
  genericDefaultProps,
  shiftOffsets,
  rewrite,
  type PatchOp,
  type Scope,
  type TemplateNode,
  type ElementNode,
  type Attr,
  type SnippetNode,
  type ComponentSourceLoc,
  type AutoReturnResult,
  bindsName,
  onProp,
} from '@weave-framework/compiler';

const FOR_VARS: string[] = ['$index', '$count', '$first', '$last', '$even', '$odd'];
const HAS_SETUP: RegExp = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;
const HAS_PROP_DEFAULTS: RegExp = /export\s+(?:const|let|var)\s+propDefaults\b/;

/** A capitalized tag (`<TaskCard>`) is a child component, not a DOM element. */
const isComponentTag = (tag: string): boolean => /^[A-Z]/.test(tag);

/** Object-literal key: bare when a valid identifier, else quoted. */
const propKey = (name: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

/**
 * A verbatim run linking the generated module to its source, char-precise. The
 * `source` tag selects which file `sourceOffset` indexes into (a SFC keeps both
 * in the same file; the separate form splits script ↔ template across two).
 */
export interface WeaveMapping {
  /** offset into the generated `text` */
  generatedOffset: number;
  /** offset into the mapped source file (see `source`) */
  sourceOffset: number;
  /** run length (same on both sides) */
  length: number;
  /** `script` → `scriptFile`/`scriptText`; `template` → `templateFile`/`templateText` */
  source: 'script' | 'template';
}

/** A generated virtual module plus everything needed to map its diagnostics back. */
export interface Virtual {
  /** Virtual module path (drives module resolution); never written to disk. */
  path: string;
  /** The generated TypeScript source. */
  text: string;
  /** File reported for template-region errors. */
  templateFile: string;
  /** Offset-faithful template text (template `sourceOffset`s index into this). */
  templateText: string;
  /** virtual line (1-based) → source offset into `templateText`. */
  templateMap: Map<number, number>;
  /** File reported for script-region (user TS) errors. */
  scriptFile: string;
  /** Script source text (script `sourceOffset`s index into this). */
  scriptText: string;
  /** 0-based line in `scriptFile` where the embedded script begins. */
  scriptLine: number;
  /** Number of leading virtual lines occupied by the embedded script. */
  scriptLineCount: number;
  /** Char-precise generated↔source runs for editor tooling. */
  mappings: WeaveMapping[];
  /**
   * Offsets at or above this belong to ANOTHER file, and its own check reports them — so a diagnostic
   * mapping here is dropped rather than reported twice against the wrong source.
   *
   * Only a `#3` patch extension sets it. Its harness has to emit the whole BASE template, because that
   * is what gives a patched expression its enclosing scope (`{{ f(item) }}` inside the base's `@for`),
   * but an error in the base's own markup is the base's, at the base's line, and is already reported
   * there. Tagging those offsets out of range is what tells the two apart.
   */
  foreignFrom?: number;
}

/**
 * Offsets in a `#3` patch harness that came from the BASE template are shifted into this range.
 *
 * It sits far past any real file length, so a tagged offset can never be confused with a genuine one —
 * and if the tagging were ever dropped, the base's offsets would collide with the extension's and the
 * diagnostic would land on an unrelated line rather than fail loudly.
 */
export const FOREIGN_OFFSET: number = 1_000_000_000;

interface LineSeg {
  /** column within this line's `text` */
  col: number;
  /** source offset (into templateText) */
  src: number;
  /** run length */
  len: number;
}

interface Line {
  text: string;
  /** source offset this line maps to (an expression), or undefined for scaffolding */
  offset?: number;
  /** char-precise verbatim runs within this line, mapping `text` cols → source */
  segs?: LineSeg[];
}

/** Chainable single-line builder accumulating text + char-precise mappings. */
interface Builder {
  lit(s: string): Builder;
  expr(srcOffset: number | undefined, exprStr: string, locals: Set<string>): Builder;
  /** Verbatim text that still maps back to source (an identifier we emit, not rewrite). */
  mapped(srcOffset: number | undefined, s: string): Builder;
  push(offset?: number): void;
}

/** Injection span (into `assemble`'s script) when auto-expose added a `return`, else undefined. */
function injectionOf(auto: AutoReturnResult): { at: number; len: number } | undefined {
  return auto.injectedAt !== undefined && auto.injectedLen !== undefined
    ? { at: auto.injectedAt, len: auto.injectedLen }
    : undefined;
}

/**
 * How a PascalCase tag finds its module — injected, never imported.
 *
 * The lookup needs a filesystem; this module must not. It is bundled into the browser by the mapping
 * tests (which import `../src/emit.js` directly to stay clear of the node-only `check.ts`/`project.ts`),
 * and one `node:fs` import here breaks that bundle outright. So Node callers — `checkProject`, the
 * language server — pass `resolveChildModule` from `./children-fs.js`; a browser bundle passes nothing
 * and simply resolves no children, which its fixtures never rely on.
 */
export type ResolveChild = (tag: string, dir: string) => string | null;

/**
 * The imports a component's harness needs for the child tags its template composes but its script does
 * not import — exactly the set the build loader injects, so both agree on what compiles.
 */
function childImports(
  nodes: TemplateNode[],
  script: string | undefined,
  tsPath: string,
  resolveChild?: ResolveChild
): string[] {
  if (!resolveChild) return [];
  // `dirname`, spelled out: this module cannot import `node:path` (see ResolveChild above), and both
  // separators have to be honoured — a Windows path is backslashed, and half of one is worse than none.
  const cut: number = Math.max(tsPath.lastIndexOf('/'), tsPath.lastIndexOf('\\'));
  const dir: string = cut === -1 ? '.' : tsPath.slice(0, cut);
  const out: string[] = [];
  for (const tag of composedTags(nodes)) {
    if (bindsName(script, tag)) continue;
    const spec: string | null = resolveChild(tag, dir);
    // An unresolvable tag is left alone on purpose: TypeScript then reports `Cannot find name '<Tag>'`,
    // which is what the build says about it too, in the same place.
    if (spec) out.push(`import ${tag} from ${JSON.stringify(spec)};`);
  }
  return out;
}

/** Every capitalized tag in a template, deduplicated — a component tag is one that starts uppercase. */
export function composedTags(nodes: TemplateNode[]): string[] {
  const seen: Set<string> = new Set();
  const visit = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== 'object') continue;
      const n: Record<string, unknown> = node as Record<string, unknown>;
      if (n.type === 'element' && typeof n.tag === 'string' && /^[A-Z]/.test(n.tag)) seen.add(n.tag);
      for (const key of ['children', 'branches', 'cases', 'empty', 'placeholder', 'pending', 'then', 'catch']) {
        visit(n[key]);
      }
    }
  };
  visit(nodes);
  return [...seen];
}

/** Build a virtual module for a `.weave` SFC. */
export function buildVirtualSfc(filePath: string, source: string, resolveChild?: ResolveChild): Virtual {
  const loc: ComponentSourceLoc = parseSfcLoc(source);
  const nodes: TemplateNode[] = parseTemplate(loc.template);
  const names: string[] = inferCtxNames(nodes);
  const body: Line[] = emit(nodes, new Set(names));
  const hasSetup: boolean = HAS_SETUP.test(loc.script ?? '');
  // Auto-expose: type the context off a synthesized `return` when setup omits one, so
  // `ReturnType<typeof setup>` matches what the runtime module (loader) will also expose.
  const auto: AutoReturnResult = hasSetup ? injectAutoReturn(loc.script ?? '', names) : { code: loc.script ?? '' };
  const asm: ReturnType<typeof assemble> = assemble(
    auto.code || undefined,
    hasSetup,
    body,
    loc.scriptOffset,
    injectionOf(auto),
    undefined,
    childImports(nodes, loc.script, filePath, resolveChild)
  );
  return {
    path: filePath + '.ts',
    text: asm.text,
    templateFile: filePath,
    templateText: loc.template,
    templateMap: asm.templateMap,
    scriptFile: filePath,
    scriptText: source,
    scriptLine: loc.scriptLine,
    scriptLineCount: asm.scriptLineCount,
    mappings: asm.mappings,
  };
}

/** Build a virtual module for the separate-file form (`name.ts` + `name.html`). */
export function buildVirtualSeparate(
  tsPath: string,
  tsSource: string,
  htmlPath: string,
  htmlSource: string,
  resolveChild?: ResolveChild
): Virtual {
  const nodes: TemplateNode[] = parseTemplate(htmlSource);
  const names: string[] = inferCtxNames(nodes);
  const body: Line[] = emit(nodes, new Set(names));
  const hasSetup: boolean = HAS_SETUP.test(tsSource);
  const auto: AutoReturnResult = hasSetup ? injectAutoReturn(tsSource, names) : { code: tsSource };
  const asm: ReturnType<typeof assemble> = assemble(
    auto.code || undefined,
    hasSetup,
    body,
    0,
    injectionOf(auto),
    undefined,
    childImports(nodes, tsSource, tsPath, resolveChild)
  );
  return {
    // Live at the real `.ts` path (shadowing disk) so a parent's `import Foo from
    // './foo'` resolves to this virtual — which carries the synthesized typed
    // default export — instead of the on-disk source (which has only `setup`).
    path: tsPath,
    text: asm.text,
    templateFile: htmlPath,
    templateText: htmlSource,
    templateMap: asm.templateMap,
    scriptFile: tsPath,
    scriptText: tsSource,
    scriptLine: 0,
    scriptLineCount: asm.scriptLineCount,
    mappings: asm.mappings,
  };
}

/**
 * How a `#3` extension names its base's template context.
 *
 * `spec` is the module specifier that resolves to the BASE's own virtual — the harness imports its
 * `__WeaveCtx` and intersects. Absent when the base was not among the checked files: then the base half
 * of the context degrades to `Record<string, any>`, which checks less but never invents an error about
 * a binding that really does exist.
 */
export interface BaseCtx {
  spec?: string;
}

/**
 * Build a virtual module for a `#3` component-file extension — one that writes no template of its own
 * and declares `export const patch = [ … ]` against its base's.
 *
 * The whole PATCHED template is emitted, not just the inserted fragments, because a fragment's scope is
 * the markup around it: `on:dblclick={{ pick(item) }}` patched onto a row inside the base's `@for` reads
 * a local that only exists there. Errors in the base's own markup are dropped ({@link Virtual.foreignFrom})
 * — the base is checked as itself, and reporting them twice, against the extension's file, would be worse
 * than not reporting them here at all.
 */
export function buildVirtualPatch(
  tsPath: string,
  tsSource: string,
  script: string,
  baseTemplate: string,
  ops: PatchOp[],
  baseCtx: BaseCtx,
  resolveChild?: ResolveChild
): Virtual {
  // The base's offsets are tagged out of range BEFORE patching, so the fragments the ops splice in keep
  // the real `.ts` offsets `readPatchOps` gave them and stay distinguishable from everything around them.
  const baseNodes: TemplateNode[] = parseTemplate(baseTemplate);
  shiftOffsets(baseNodes, FOREIGN_OFFSET);
  const nodes: TemplateNode[] = applyPatches(baseNodes, ops);
  const all: string[] = inferCtxNames(nodes);
  const body: Line[] = emit(nodes, new Set(all));
  const hasSetup: boolean = HAS_SETUP.test(script);
  // `injectAutoReturn` drops the names this setup cannot see, which for an extension is most of them:
  // the context here is the base's plus its own. Same call as every other component, deliberately — the
  // rule belongs in one place, and this path is where its absence first showed.
  const auto: AutoReturnResult = hasSetup ? injectAutoReturn(script, all) : { code: script };
  const asm: ReturnType<typeof assemble> = assemble(
    auto.code || undefined,
    hasSetup,
    body,
    0,
    injectionOf(auto),
    baseCtx,
    childImports(nodes, script, tsPath, resolveChild)
  );
  return {
    path: tsPath,
    text: asm.text,
    // Both regions are the extension's own `.ts`: the markup it owns lives inside string literals there.
    templateFile: tsPath,
    templateText: tsSource,
    templateMap: asm.templateMap,
    scriptFile: tsPath,
    scriptText: tsSource,
    scriptLine: 0,
    scriptLineCount: asm.scriptLineCount,
    mappings: asm.mappings,
    foreignFrom: FOREIGN_OFFSET,
  };
}

/* ──────────── harness body emitter ──────────── */

function emit(nodes: TemplateNode[], ctx: Set<string>): Line[] {
  const lines: Line[] = [];
  let awaitN: number = 0; // unique source-binding names for `@await` type-queries

  // A plain scaffolding line (no source mapping), optionally pinned to a source
  // offset for the legacy line→offset `templateMap`.
  const push = (text: string, offset?: number): void => {
    lines.push({ text, offset });
  };

  // ctx names → `__ctx.name`; template locals → the bare lexical name.
  const scopeOf = (locals: Set<string>): Scope => {
    const s: Scope = new Map();
    for (const n of ctx) s.set(n, { kind: 'ctx' });
    for (const n of locals) s.set(n, { kind: 'local' });
    return s;
  };

  // A chainable line builder: `lit()` appends scaffolding text, `expr()` appends a
  // rewritten template expression and records its char-precise src↔gen segments
  // (offset by where the expression landed in the line). `push()` flushes the line.
  const mk = (): Builder => {
    let text: string = '';
    const segs: LineSeg[] = [];
    const api: Builder = {
      lit(s: string): Builder {
        text += s;
        return api;
      },
      expr(srcOffset: number | undefined, exprStr: string, locals: Set<string>): Builder {
        const r: ReturnType<typeof rewrite> = rewrite(exprStr, scopeOf(locals), '__ctx');
        // Length-preserving flatten keeps the statement single-line (so the legacy
        // line map stays valid) without shifting any segment offset.
        const code: string = r.code.replace(/[\r\n]/g, ' ');
        const base: number = text.length;
        if (srcOffset !== undefined) {
          for (const s of r.segments) segs.push({ col: base + s.gen, src: srcOffset + s.src, len: s.len });
        }
        text += code;
        return api;
      },
      mapped(srcOffset: number | undefined, s: string): Builder {
        if (srcOffset !== undefined) segs.push({ col: text.length, src: srcOffset, len: s.length });
        text += s;
        return api;
      },
      push(offset?: number): void {
        lines.push({ text, offset, segs });
      },
    };
    return api;
  };

  // A non-static attribute on a DOM element (or a directive on a component):
  // place its expression in a type-checked position. `use:`/`transition:` verify
  // the referenced fn is callable with the runtime's (Element, arg) pair.
  const emitAttr = (attr: Attr, locals: Set<string>): void => {
    if (attr.type === 'static') return;
    if (attr.type === 'use' || attr.type === 'transition') {
      const at: number | undefined = attr.nameOffset ?? attr.offset;
      const b: Builder = mk().lit('  (').expr(at, attr.name, locals);
      if (attr.expr !== undefined) b.lit(')(null as any, ').expr(attr.offset, attr.expr, locals).lit(');');
      else b.lit(')(null as any);');
      b.push(at);
      return;
    }
    mk().lit('  void (').expr(attr.offset, attr.expr, locals).lit(');').push(attr.offset);
  };

  // A child component `<Tag prop={expr} …>`: assemble its data props into one typed
  // object literal checked against the child's prop contract (the first parameter of
  // its `setup`, exposed via the generated default export). Required/excess/mismatched
  // props all surface, each pinned to its own attribute. Events stay outside the
  // contract (the runtime wires them) but their handler bodies are still checked.
  // Unique names for the per-event assignments; a template may hold many.
  let evSeq: number = 0;
  const evVar = (): string => `__ev${evSeq++}`;

  const emitComponent = (node: ElementNode, locals: Set<string>): void => {
    const dataProps: Array<{
      key: string;
      expr?: string;
      srcOffset?: number;
      keyOffset?: number;
      staticVal?: string;
    }> = [];
    const eventProps: Array<{ key: string; expr: string; srcOffset?: number; keyOffset?: number }> = [];
    for (const attr of node.attrs) {
      if (attr.type === 'static') {
        if (attr.name === 'slot') continue; // slot marker, stripped by codegen
        // A bare attribute (`<Button disabled>`) type-checks as the boolean `true`,
        // matching what codegen emits; a quoted value stays a string literal.
        dataProps.push({
          key: attr.name,
          staticVal: attr.bare ? 'true' : JSON.stringify(attr.value),
          keyOffset: attr.nameOffset,
        });
      } else if (attr.type === 'attr') {
        dataProps.push({ key: attr.name, expr: attr.expr, srcOffset: attr.offset, keyOffset: attr.nameOffset });
      } else if (attr.type === 'bind') {
        // `bind:value={{ sig }}` passes the signal itself — check it against the child's prop.
        dataProps.push({ key: attr.name, expr: attr.expr, srcOffset: attr.offset, keyOffset: attr.nameOffset });
      } else if (attr.type === 'event') {
        // `on:add={{ fn }}` IS the prop `onAdd` — codegen puts it in the same object through the same
        // `onProp`, so a child that DECLARES `onAdd` must see it satisfied and must have the handler's
        // type checked. But a child that does NOT declare it is equally correct: `defineComponent`
        // forwards an undeclared `on:x` to the rendered root element as a DOM listener, which is how
        // `<Button on:click={{ fn }}>` works and why `ButtonProps` has no `onClick`.
        //
        // Both at once, via a SPREAD. TypeScript checks a spread member's type against the target and
        // reports a missing required prop, but skips EXCESS-property checking on it — measured, not
        // assumed. Emitting events inline instead produced 78 TS2353s across this repository's own docs,
        // every one of them on markup that builds and runs.
        eventProps.push({ key: onProp(attr.name), expr: attr.expr, srcOffset: attr.offset, keyOffset: attr.nameOffset });
      } else {
        emitAttr(attr, locals); // stray directives — checked, not part of props
      }
    }
    const anchor: number | undefined = dataProps.find((p) => p.srcOffset !== undefined)?.srcOffset;
    // The props are checked by CALLING the component, not by annotating a const with its first
    // parameter's type. `Parameters<typeof X>[0]` reads a GENERIC component wrong: it resolves every
    // type parameter to `unknown`, so `<Select options={{ … }}>` accepted an array of anything, and a
    // template cannot write a type argument to get the checking back. A call infers the parameter from
    // the props being passed, which is what the runtime does with them anyway.
    //
    // The tag name is emitted as a *mapped* expression (not scaffolding), so the `<Component>` tag
    // itself supports go-to-definition into the `.ts` import and an unknown tag surfaces
    // "Cannot find name 'X'" pinned to the tag span.
    mk()
      .lit('  void ')
      .expr(node.tagOffset, node.tag, locals)
      .lit(`({`)
      .push(anchor ?? node.tagOffset);
    for (const p of dataProps) {
      // The KEY is emitted mapped (not as scaffolding): TypeScript reports a prop-contract
      // violation — a mismatched type (TS2322) or a prop the child doesn't declare (TS2353)
      // — at the property key. Unmapped, those diagnostics fall outside every mapping and
      // the editor silently shows nothing, while `weave check` (line-mapped) still flags them.
      if (p.expr !== undefined) {
        mk()
          .lit('    ')
          .mapped(p.keyOffset, propKey(p.key))
          .lit(': (')
          .expr(p.srcOffset, p.expr, locals)
          .lit('),')
          .push(p.srcOffset ?? p.keyOffset);
      } else {
        mk()
          .lit('    ')
          .mapped(p.keyOffset, propKey(p.key))
          .lit(`: (${p.staticVal}),`)
          .push(p.keyOffset);
      }
    }
    // An `on:x` handler has to do two contradictory-looking things, so it does them in two places.
    //
    // In the props object it appears only as its TYPE, via `__WeaveGiven`: if the child declares `onX`,
    // that satisfies a required handler; if it does not, `Extract` is `never`, `Pick` is `{}`, and
    // nothing is contributed. Two simpler attempts failed on this repository's own documentation —
    // emitting the handler inline gave 78 TS2353 "does not exist in type ButtonProps", and spreading the
    // literal gave 41 TS2559, because `ButtonProps` is all-optional and TypeScript's weak-type rule
    // rejects an object whose only member is undeclared. Both were markup that builds and runs.
    for (const e of eventProps) {
      mk()
        .lit('    ...__weaveGiven<__WeaveGiven<typeof ')
        .expr(node.tagOffset, node.tag, locals)
        .lit(`, '${e.key}'>>(),`)
        .push(e.keyOffset ?? e.srcOffset);
    }
    push(`  });`);
    // And the handler's own type is checked here, where a mismatch can be pinned to the handler rather
    // than to the whole call. `__WeaveEv` resolves to `unknown` for an event the child does not declare,
    // which is exactly the forwarding case: `defineComponent` hands it to the root element instead.
    for (const e of eventProps) {
      mk()
        .lit(`  const ${evVar()}: __WeaveEv<typeof `)
        .expr(node.tagOffset, node.tag, locals)
        .lit(`, '${e.key}'> = (`)
        .expr(e.srcOffset, e.expr, locals)
        .lit(');')
        .push(e.srcOffset ?? e.keyOffset);
    }
  };

  const walk = (list: TemplateNode[], locals: Set<string>): void => {
    let scope: Set<string> = locals; // `@let` extends scope for following siblings
    // Hoist sibling snippets to typed arrows first (params: any), so a `@render`
    // call type-checks the snippet name/arity regardless of declaration order.
    const snippets: SnippetNode[] = list.filter((n): n is SnippetNode => n.type === 'snippet');
    if (snippets.length) {
      scope = new Set(scope);
      for (const s of snippets) scope.add(s.name);
      for (const s of snippets) {
        // Authored `@snippet row(ctx: T)` type-checks the body against `T`; an
        // un-annotated param stays `any` (backward compatible).
        const params: string = s.params.map((p, idx) => `${p}: ${s.paramTypes?.[idx] ?? 'any'}`).join(', ');
        // A `@snippet` renders DOM, so type it `() => Node` (not `void`) — that's what a
        // `@render` mounts AND what a template-prop like `rowTemplate`/`itemTemplate`/`tabTemplate`
        // (typed `(row) => Node`) expects, so passing a snippet to one type-checks. The body is
        // emitted as statements (no real return); a trailing typed return satisfies the annotation.
        push(`  const ${s.name} = (${params}): __WeaveNode => {`);
        const inner: Set<string> = new Set(scope);
        for (const p of s.params) inner.add(p);
        walk(s.children, inner);
        push(`    return null as unknown as __WeaveNode;`);
        push(`  };`);
      }
    }
    for (const node of list) {
      switch (node.type) {
        case 'snippet':
          break; // already emitted above
        case 'render':
          mk().lit('  void (').expr(node.exprOffset, node.expr, scope).lit(');').push(node.exprOffset);
          break;
        case 'key':
          mk().lit('  void (').expr(node.exprOffset, node.expr, scope).lit(');').push(node.exprOffset);
          walk(node.children, scope);
          break;
        case 'text':
          break;
        case 'comment':
          break; // dropped at compile time; only the formatter opts into comment nodes
        case 'interp':
          // Text interpolation is the one position where a FUNCTION is never what the author meant:
          // `{{ count }}` instead of `{{ count() }}` renders the signal getter's source into the page.
          // `__wText` refuses a callable, and its parameter type carries the advice (see the prelude).
          mk().lit('  __wText(').expr(node.offset, node.expr, scope).lit(');').push(node.offset);
          break;
        case 'let': {
          mk().lit(`  const ${node.name} = (`).expr(node.exprOffset, node.expr, scope).lit(');').push(node.exprOffset);
          scope = new Set(scope).add(node.name);
          break;
        }
        case 'element':
          if (isComponentTag(node.tag)) {
            emitComponent(node, scope);
            walk(node.children, scope); // slot content is authored in the parent scope
            break;
          }
          for (const attr of node.attrs) emitAttr(attr, scope);
          walk(node.children, scope);
          break;
        case 'if':
          for (const br of node.branches) {
            if (br.cond !== undefined) {
              mk().lit('  if (').expr(br.condOffset, br.cond, scope).lit(') {').push(br.condOffset);
            } else {
              push(`  {`);
            }
            let inner: Set<string> = scope;
            if (br.alias && br.cond !== undefined) {
              mk().lit(`    const ${br.alias} = (`).expr(br.condOffset, br.cond, scope).lit(');').push(br.condOffset);
              inner = new Set(scope).add(br.alias);
            }
            walk(br.children, inner);
            push(`  }`);
          }
          break;
        case 'for': {
          mk().lit(`  for (const ${node.item} of (`).expr(node.listOffset, node.list, scope).lit(')) {').push(node.listOffset);
          push(
            `    const $index: number = 0, $count: number = 0, ` +
              `$first: boolean = true, $last: boolean = true, ` +
              `$even: boolean = true, $odd: boolean = true;`
          );
          const inner: Set<string> = new Set(scope).add(node.item);
          for (const v of FOR_VARS) inner.add(v);
          if (node.track) mk().lit('    void (').expr(node.trackOffset, node.track, inner).lit(');').push(node.trackOffset);
          walk(node.children, inner);
          push(`  }`);
          if (node.empty) walk(node.empty, scope);
          break;
        }
        case 'switch': {
          mk().lit('  switch (').expr(node.exprOffset, node.expr, scope).lit(') {').push(node.exprOffset);
          for (const c of node.cases) {
            if (c.test !== undefined) {
              mk().lit('    case ').expr(c.testOffset, c.test, scope).lit(': {').push(c.testOffset);
            } else {
              push(`    default: {`);
            }
            walk(c.children, scope);
            push(`    break; }`);
          }
          push(`  }`);
          break;
        }
        case 'defer': {
          if (node.trigger.kind === 'when') {
            mk().lit('  void (').expr(node.trigger.exprOffset, node.trigger.expr, scope).lit(');').push(node.trigger.exprOffset);
          } else if (node.trigger.kind === 'timer') {
            mk().lit('  void (').expr(node.trigger.msOffset, node.trigger.ms, scope).lit(');').push(node.trigger.msOffset);
          }
          walk(node.children, scope);
          if (node.placeholder) walk(node.placeholder, scope);
          break;
        }
        case 'await': {
          // Bind the source to a const so a `typeof` type-query has an entity name
          // (`typeof (expr)` is a syntax error in a type position) — and so the source
          // expression itself is type-checked. Only needed when `@then` binds an alias.
          let srcVar: string = '';
          if (node.then?.alias) {
            srcVar = `__await${awaitN++}`;
            mk().lit(`  const ${srcVar} = (`).expr(node.exprOffset, node.expr, scope).lit(');').push(node.exprOffset);
          } else {
            mk().lit('  void (').expr(node.exprOffset, node.expr, scope).lit(');').push(node.exprOffset);
          }
          if (node.pending) walk(node.pending, scope);
          if (node.then) {
            push(`  {`);
            let inner: Set<string> = scope;
            if (node.then.alias) {
              // the resolved value: a resource's data type or the awaited Promise type
              push(
                `    const ${node.then.alias}: __WeaveAwaited<typeof ${srcVar}> = undefined as any;`,
                node.exprOffset
              );
              inner = new Set(scope).add(node.then.alias);
            }
            walk(node.then.children, inner);
            push(`  }`);
          }
          if (node.catch) {
            push(`  {`);
            let inner: Set<string> = scope;
            if (node.catch.alias) {
              push(`    const ${node.catch.alias}: unknown = undefined;`);
              inner = new Set(scope).add(node.catch.alias);
            }
            walk(node.catch.children, inner);
            push(`  }`);
          }
          break;
        }
      }
    }
  };

  walk(nodes, new Set());
  return lines;
}

/* ──────────── assembly + line bookkeeping ──────────── */

function assemble(
  script: string | undefined,
  hasSetup: boolean,
  body: Line[],
  scriptBaseOffset: number,
  injection?: { at: number; len: number },
  baseCtx?: BaseCtx,
  imports: string[] = []
): { text: string; scriptLineCount: number; templateMap: Map<number, number>; mappings: WeaveMapping[] } {
  const out: string[] = [];
  const scriptLines: string[] = script ? script.split('\n') : [];
  for (const l of scriptLines) out.push(l);

  out.push('');
  // Child components the template composes and the script does not import — the build loader injects
  // exactly these, so the harness must have them too or the checker disagrees with the thing that runs.
  // They go AFTER the author's script, so every line of it keeps its number.
  for (const line of imports) out.push(line);
  // A `#3` extension's template context is the BASE's, with its own setup layered on top — that is what
  // `extendSetup(extend, setup)` builds at runtime, so the harness has to say the same thing or a patched
  // expression reading a base binding is an error here and correct everywhere else.
  if (baseCtx?.spec) out.push(`import type { __WeaveCtx as __WeaveBaseCtx } from ${JSON.stringify(baseCtx.spec)};`);
  const ownCtx: string = hasSetup ? 'ReturnType<typeof setup>' : 'Record<string, any>';
  const withBase: string = baseCtx ? ` & ${baseCtx.spec ? '__WeaveBaseCtx' : 'Record<string, any>'}` : '';
  // Exported so an extension patching THIS component can name its context. A type export changes nothing
  // else: the harness is never emitted.
  out.push(`export type __WeaveCtx = ${ownCtx}${withBase};`);
  out.push('declare const __ctx: __WeaveCtx;');
  // `@await (src)` resolved-value type: a resource's data type, else the awaited Promise.
  out.push('type __WeaveAwaited<S> = S extends { data: () => infer D } ? NonNullable<D> : Awaited<S>;');
  // A child component's prop contract = the first parameter of its `setup`.
  // The component's own script is embedded verbatim in this same module, so any global name used below
  // can be SHADOWED by it. A component that declares its own `interface Node` (a tree, a graph, a menu —
  // the most natural name in the world) silently retyped its own default export, and every parent that
  // rendered it got `Type 'Node' is not assignable to type 'Node'`. Going through `globalThis` is not
  // shadowable: a local type declaration lives in a different declaration space from the global VALUE.
  out.push('type __WeaveNode = typeof globalThis.Node.prototype;');
  // `on:x` on a component is checked ONLY when the child declares `onX`. If it does, the handler must
  // match that prop's type; if it does not, `defineComponent` forwards the handler to the rendered root
  // element as a DOM listener, which is how `<Button on:click={{ fn }}>` works with a `ButtonProps` that
  // has no `onClick`. `unknown` in the false branch is what makes the second case silent.
  out.push('type __WeaveProps<F> = F extends (p: infer P, ...rest: never[]) => unknown ? P : never;');
  out.push("type __WeaveEv<F, K extends string> = K extends keyof __WeaveProps<F> ? __WeaveProps<F>[K] : unknown;");
  // The child's own declaration of `onX`, or `{}` when it has none. Spread into the props object, this
  // SATISFIES a required handler without ever being an excess property — `Extract` collapses to `never`
  // for an undeclared one, and `Pick<P, never>` is `{}`, which contributes nothing.
  out.push("type __WeaveGiven<F, K extends string> = Pick<__WeaveProps<F>, Extract<K, keyof __WeaveProps<F>>>;");
  out.push('declare function __weaveGiven<T>(): T;');
  out.push('type __WeavePropsOf<F> = F extends (props: infer P, ...rest: any[]) => any ? P : Record<string, never>;');
  // With `export const propDefaults`, the defaulted keys become optional for a PARENT
  // (setup still sees them as declared); a key in D but not P is ignored.
  out.push('type __WeaveWithDefaults<P, D> = Omit<P, keyof D> & Partial<Pick<P, Extract<keyof D, keyof P>>>;');
  // Text interpolation guard. A function reaching `{{ }}` is stringified into the page — the classic
  // "forgot the `()`" — so the harness routes every interpolation through a parameter type that a
  // callable cannot satisfy, and whose NAME is the error message TypeScript will print.
  out.push(
    'type __WeaveTextValue<T> = T extends (...args: never[]) => unknown ' +
      "? { __weave: 'a function renders as its own source text — call it, e.g. {{ count() }}' } : T;"
  );
  out.push('declare function __wText<T>(value: __WeaveTextValue<T>): void;');
  out.push('function __weave__(): void {');

  const bodyBase: number = out.length; // out index of body[0]
  const templateMap: Map<number, number> = new Map<number, number>();
  body.forEach((ln, i) => {
    out.push(ln.text);
    if (ln.offset !== undefined) templateMap.set(bodyBase + i + 1, ln.offset); // +1 → 1-based line
  });

  out.push('}');
  // Synthesize the typed default export the loader emits at build time
  // (`defineComponent(render, setup)`), so a PARENT importing this component
  // type-checks the props it passes against this component's `setup` contract.
  // A GENERIC setup cannot be read by extraction: `F extends (props: infer P, …)` applied to an
  // uninstantiated generic resolves every type parameter to `unknown`, and the declared default does not
  // apply (a default is for a CALL, not for destructuring a type). So `<Select options={{ … }}>` was
  // checked against `unknown[]` and accepted an array of anything. The parameters are re-declared from
  // the source instead. A non-generic component keeps the extraction, which is exact.
  const generic: { typeParams: string; propsType: string } | null = script ? genericDefaultProps(script) : null;
  const baseProps: string = generic
    ? generic.propsType
    : hasSetup
      ? '__WeavePropsOf<typeof setup>'
      : 'Record<string, never>';
  const propsType: string =
    script && HAS_PROP_DEFAULTS.test(script) ? `__WeaveWithDefaults<${baseProps}, typeof propDefaults>` : baseProps;
  const typeParams: string = generic ? `<${generic.typeParams}>` : '';
  // `=> Node`, matching the runtime's `Component` type: an instance always returns its DOM. With
  // `unknown` here, calling a component imperatively — a `<Table>` cell, an `<Expansion>` body,
  // anything typed `(…) => Node` — needed a cast at every call site.
  out.push(
    `declare const __weaveDefault: ${typeParams}(props: ${propsType}, slots?: Record<string, () => __WeaveNode>) => __WeaveNode;`
  );
  out.push('export default __weaveDefault;'); // also forces module scope

  // Char-precise mappings. The script is embedded verbatim at the very top, so it
  // maps 1:1 as a single run; template runs are placed by each line's offset. When
  // auto-expose injected a `return`, the script is embedded WITH that insertion, so
  // it maps as two runs around the injected span (which maps to nothing) — the region
  // before shifts by 0, the region after by the injected length.
  const mappings: WeaveMapping[] = [];
  if (script && script.length) {
    if (injection) {
      const { at, len } = injection;
      if (at > 0) {
        mappings.push({ generatedOffset: 0, sourceOffset: scriptBaseOffset, length: at, source: 'script' });
      }
      const tail: number = script.length - (at + len); // original chars after the injection point
      if (tail > 0) {
        mappings.push({ generatedOffset: at + len, sourceOffset: scriptBaseOffset + at, length: tail, source: 'script' });
      }
    } else {
      mappings.push({ generatedOffset: 0, sourceOffset: scriptBaseOffset, length: script.length, source: 'script' });
    }
  }
  const lineGenOffset: number[] = new Array<number>(out.length);
  let acc: number = 0;
  for (let k: number = 0; k < out.length; k++) {
    lineGenOffset[k] = acc;
    acc += out[k].length + 1; // +1 for the joining '\n'
  }
  body.forEach((ln, i) => {
    if (!ln.segs) return;
    const gBase: number = lineGenOffset[bodyBase + i];
    for (const s of ln.segs) {
      mappings.push({ generatedOffset: gBase + s.col, sourceOffset: s.src, length: s.len, source: 'template' });
    }
  });

  return { text: out.join('\n'), scriptLineCount: scriptLines.length, templateMap, mappings };
}
