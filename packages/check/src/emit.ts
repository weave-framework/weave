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
  rewrite,
  type Scope,
  type TemplateNode,
  type ElementNode,
  type Attr,
  type SnippetNode,
  type ComponentSourceLoc,
  type AutoReturnResult,
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
}

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

/** Build a virtual module for a `.weave` SFC. */
export function buildVirtualSfc(filePath: string, source: string): Virtual {
  const loc: ComponentSourceLoc = parseSfcLoc(source);
  const nodes: TemplateNode[] = parseTemplate(loc.template);
  const names: string[] = inferCtxNames(nodes);
  const body: Line[] = emit(nodes, new Set(names));
  const hasSetup: boolean = HAS_SETUP.test(loc.script ?? '');
  // Auto-expose: type the context off a synthesized `return` when setup omits one, so
  // `ReturnType<typeof setup>` matches what the runtime module (loader) will also expose.
  const auto: AutoReturnResult = hasSetup ? injectAutoReturn(loc.script ?? '', names) : { code: loc.script ?? '' };
  const asm: ReturnType<typeof assemble> = assemble(auto.code || undefined, hasSetup, body, loc.scriptOffset, injectionOf(auto));
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
  htmlSource: string
): Virtual {
  const nodes: TemplateNode[] = parseTemplate(htmlSource);
  const names: string[] = inferCtxNames(nodes);
  const body: Line[] = emit(nodes, new Set(names));
  const hasSetup: boolean = HAS_SETUP.test(tsSource);
  const auto: AutoReturnResult = hasSetup ? injectAutoReturn(tsSource, names) : { code: tsSource };
  const asm: ReturnType<typeof assemble> = assemble(auto.code || undefined, hasSetup, body, 0, injectionOf(auto));
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

/* ──────────── harness body emitter ──────────── */

function emit(nodes: TemplateNode[], ctx: Set<string>): Line[] {
  const lines: Line[] = [];
  let awaitN: number = 0; // unique source-binding names for `@await` type-queries
  let propsN: number = 0; // unique names for child-component prop-check objects

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
  const emitComponent = (node: ElementNode, locals: Set<string>): void => {
    const dataProps: Array<{
      key: string;
      expr?: string;
      srcOffset?: number;
      keyOffset?: number;
      staticVal?: string;
    }> = [];
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
      } else {
        emitAttr(attr, locals); // events / stray directives — checked, not part of props
      }
    }
    const id: string = `__props${propsN++}`;
    const anchor: number | undefined = dataProps.find((p) => p.srcOffset !== undefined)?.srcOffset;
    // The tag name is emitted as a *mapped* expression (not scaffolding), so the
    // `<Component>` tag itself supports go-to-definition into the `.ts` import and an
    // unknown tag surfaces "Cannot find name 'X'" pinned to the tag span.
    mk()
      .lit(`  const ${id}: NonNullable<Parameters<typeof `)
      .expr(node.tagOffset, node.tag, locals)
      .lit(`>[0]> = {`)
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
    push(`  };`);
    push(`  void ${id};`);
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
        push(`  const ${s.name} = (${params}): Node => {`);
        const inner: Set<string> = new Set(scope);
        for (const p of s.params) inner.add(p);
        walk(s.children, inner);
        push(`    return null as unknown as Node;`);
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
          mk().lit('  void (').expr(node.offset, node.expr, scope).lit(');').push(node.offset);
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
  injection?: { at: number; len: number }
): { text: string; scriptLineCount: number; templateMap: Map<number, number>; mappings: WeaveMapping[] } {
  const out: string[] = [];
  const scriptLines: string[] = script ? script.split('\n') : [];
  for (const l of scriptLines) out.push(l);

  out.push('');
  out.push(
    hasSetup
      ? 'type __WeaveCtx = ReturnType<typeof setup>;'
      : 'type __WeaveCtx = Record<string, any>;'
  );
  out.push('declare const __ctx: __WeaveCtx;');
  // `@await (src)` resolved-value type: a resource's data type, else the awaited Promise.
  out.push('type __WeaveAwaited<S> = S extends { data: () => infer D } ? NonNullable<D> : Awaited<S>;');
  // A child component's prop contract = the first parameter of its `setup`.
  out.push('type __WeavePropsOf<F> = F extends (props: infer P, ...rest: any[]) => any ? P : Record<string, never>;');
  // With `export const propDefaults`, the defaulted keys become optional for a PARENT
  // (setup still sees them as declared); a key in D but not P is ignored.
  out.push('type __WeaveWithDefaults<P, D> = Omit<P, keyof D> & Partial<Pick<P, Extract<keyof D, keyof P>>>;');
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
  const baseProps: string = hasSetup ? '__WeavePropsOf<typeof setup>' : 'Record<string, never>';
  const propsType: string =
    script && HAS_PROP_DEFAULTS.test(script) ? `__WeaveWithDefaults<${baseProps}, typeof propDefaults>` : baseProps;
  out.push(`declare const __weaveDefault: (props: ${propsType}, slots?: Record<string, () => unknown>) => unknown;`);
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
