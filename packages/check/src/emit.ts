/**
 * Virtual `.ts` generation — the heart of M8.
 *
 * For each component we synthesize a never-bundled TypeScript module: the user's
 * verbatim `setup` script, followed by a `__weave__()` harness that places every
 * template expression in a type-checked position against `ReturnType<typeof
 * setup>` (exposed as `__ctx`). Template locals (`@for` item + `$index`…, `@let`,
 * `@if … as x`) become real lexical bindings, so TypeScript scopes and narrows
 * them exactly as the runtime does.
 *
 * Each emitted statement is one line; we remember which virtual line maps to
 * which source offset, so `check.ts` can translate a `tsc` diagnostic back to the
 * original `.weave`/`.html` line:col. Errors in the script region map straight to
 * the user's code (it is embedded verbatim).
 */

import {
  parseTemplate,
  parseSfcLoc,
  inferCtxNames,
  rewrite,
  type Scope,
  type TemplateNode,
  type SnippetNode,
} from '@weave/compiler';

const FOR_VARS = ['$index', '$count', '$first', '$last', '$even', '$odd'];
const HAS_SETUP = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;

/** A generated virtual module plus everything needed to map its diagnostics back. */
export interface Virtual {
  /** Virtual module path (drives module resolution); never written to disk. */
  path: string;
  /** The generated TypeScript source. */
  text: string;
  /** File reported for template-region errors. */
  templateFile: string;
  /** Offset-faithful template text (offsets index into this). */
  templateText: string;
  /** virtual line (1-based) → source offset into `templateText`. */
  templateMap: Map<number, number>;
  /** File reported for script-region (user TS) errors. */
  scriptFile: string;
  /** 0-based line in `scriptFile` where the embedded script begins. */
  scriptLine: number;
  /** Number of leading virtual lines occupied by the embedded script. */
  scriptLineCount: number;
}

interface Line {
  text: string;
  /** source offset this line maps to (an expression), or undefined for scaffolding */
  offset?: number;
}

/** Build a virtual module for a `.weave` SFC. */
export function buildVirtualSfc(filePath: string, source: string): Virtual {
  const loc = parseSfcLoc(source);
  const nodes = parseTemplate(loc.template);
  const body = emit(nodes, new Set(inferCtxNames(nodes)));
  const asm = assemble(loc.script, HAS_SETUP.test(loc.script ?? ''), body);
  return {
    path: filePath + '.ts',
    text: asm.text,
    templateFile: filePath,
    templateText: loc.template,
    templateMap: asm.templateMap,
    scriptFile: filePath,
    scriptLine: loc.scriptLine,
    scriptLineCount: asm.scriptLineCount,
  };
}

/** Build a virtual module for the separate-file form (`name.ts` + `name.html`). */
export function buildVirtualSeparate(
  tsPath: string,
  tsSource: string,
  htmlPath: string,
  htmlSource: string
): Virtual {
  const nodes = parseTemplate(htmlSource);
  const body = emit(nodes, new Set(inferCtxNames(nodes)));
  const asm = assemble(tsSource, HAS_SETUP.test(tsSource), body);
  return {
    path: tsPath.replace(/\.ts$/, '.weave.ts'),
    text: asm.text,
    templateFile: htmlPath,
    templateText: htmlSource,
    templateMap: asm.templateMap,
    scriptFile: tsPath,
    scriptLine: 0,
    scriptLineCount: asm.scriptLineCount,
  };
}

/* ──────────── harness body emitter ──────────── */

function emit(nodes: TemplateNode[], ctx: Set<string>): Line[] {
  const lines: Line[] = [];
  let awaitN = 0; // unique source-binding names for `@await` type-queries
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
  // Rewrite an expression and flatten it to a single line (positions stay expr-level).
  const rw = (expr: string, locals: Set<string>): string =>
    rewrite(expr, scopeOf(locals), '__ctx').code.replace(/\r?\n/g, ' ');

  const walk = (list: TemplateNode[], locals: Set<string>): void => {
    let scope = locals; // `@let` extends scope for following siblings
    // Hoist sibling snippets to typed arrows first (params: any), so a `@render`
    // call type-checks the snippet name/arity regardless of declaration order.
    const snippets = list.filter((n): n is SnippetNode => n.type === 'snippet');
    if (snippets.length) {
      scope = new Set(scope);
      for (const s of snippets) scope.add(s.name);
      for (const s of snippets) {
        const params = s.params.map((p) => `${p}: any`).join(', ');
        push(`  const ${s.name} = (${params}): void => {`);
        const inner = new Set(scope);
        for (const p of s.params) inner.add(p);
        walk(s.children, inner);
        push(`  };`);
      }
    }
    for (const node of list) {
      switch (node.type) {
        case 'snippet':
          break; // already emitted above
        case 'render':
          push(`  void (${rw(node.expr, scope)});`, node.exprOffset);
          break;
        case 'key':
          push(`  void (${rw(node.expr, scope)});`, node.exprOffset);
          walk(node.children, scope);
          break;
        case 'text':
          break;
        case 'interp':
          push(`  void (${rw(node.expr, scope)});`, node.offset);
          break;
        case 'let': {
          push(`  const ${node.name} = (${rw(node.expr, scope)});`, node.exprOffset);
          scope = new Set(scope).add(node.name);
          break;
        }
        case 'element':
          for (const attr of node.attrs) {
            if (attr.type === 'static') continue;
            if (attr.type === 'use') {
              // verify the action is callable with the (Element, arg) pair; the
              // arg's type is checked against the action's 2nd parameter.
              const action = rw(attr.name, scope);
              push(
                attr.expr !== undefined
                  ? `  (${action})(null as any, ${rw(attr.expr, scope)});`
                  : `  (${action})(null as any);`,
                attr.nameOffset ?? attr.offset
              );
              continue;
            }
            push(`  void (${rw(attr.expr, scope)});`, attr.offset);
          }
          walk(node.children, scope);
          break;
        case 'if':
          for (const br of node.branches) {
            if (br.cond !== undefined) {
              push(`  if (${rw(br.cond, scope)}) {`, br.condOffset);
            } else {
              push(`  {`);
            }
            let inner = scope;
            if (br.alias && br.cond !== undefined) {
              push(`    const ${br.alias} = (${rw(br.cond, scope)});`, br.condOffset);
              inner = new Set(scope).add(br.alias);
            }
            walk(br.children, inner);
            push(`  }`);
          }
          break;
        case 'for': {
          push(`  for (const ${node.item} of (${rw(node.list, scope)})) {`, node.listOffset);
          push(
            `    const $index: number = 0, $count: number = 0, ` +
              `$first: boolean = true, $last: boolean = true, ` +
              `$even: boolean = true, $odd: boolean = true;`
          );
          const inner = new Set(scope).add(node.item);
          for (const v of FOR_VARS) inner.add(v);
          if (node.track) push(`    void (${rw(node.track, inner)});`, node.trackOffset);
          walk(node.children, inner);
          push(`  }`);
          if (node.empty) walk(node.empty, scope);
          break;
        }
        case 'switch': {
          push(`  switch (${rw(node.expr, scope)}) {`, node.exprOffset);
          for (const c of node.cases) {
            if (c.test !== undefined) {
              push(`    case ${rw(c.test, scope)}: {`, c.testOffset);
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
            push(`  void (${rw(node.trigger.expr, scope)});`, node.trigger.exprOffset);
          } else if (node.trigger.kind === 'timer') {
            push(`  void (${rw(node.trigger.ms, scope)});`, node.trigger.msOffset);
          }
          walk(node.children, scope);
          if (node.placeholder) walk(node.placeholder, scope);
          break;
        }
        case 'await': {
          // Bind the source to a const so a `typeof` type-query has an entity name
          // (`typeof (expr)` is a syntax error in a type position) — and so the source
          // expression itself is type-checked. Only needed when `@then` binds an alias.
          let srcVar = '';
          if (node.then?.alias) {
            srcVar = `__await${awaitN++}`;
            push(`  const ${srcVar} = (${rw(node.expr, scope)});`, node.exprOffset);
          } else {
            push(`  void (${rw(node.expr, scope)});`, node.exprOffset);
          }
          if (node.pending) walk(node.pending, scope);
          if (node.then) {
            push(`  {`);
            let inner = scope;
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
            let inner = scope;
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
  body: Line[]
): { text: string; scriptLineCount: number; templateMap: Map<number, number> } {
  const out: string[] = [];
  const scriptLines = script ? script.split('\n') : [];
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
  out.push('function __weave__(): void {');

  const bodyBase = out.length; // out index of body[0]
  const templateMap = new Map<number, number>();
  body.forEach((ln, i) => {
    out.push(ln.text);
    if (ln.offset !== undefined) templateMap.set(bodyBase + i + 1, ln.offset); // +1 → 1-based line
  });

  out.push('}');
  out.push('export {};'); // force module scope even when the script has no imports

  return { text: out.join('\n'), scriptLineCount: scriptLines.length, templateMap };
}
