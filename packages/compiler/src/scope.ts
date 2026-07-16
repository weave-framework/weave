/**
 * Expression scope rewriting.
 *
 * Template expressions reference two kinds of names:
 *  - **ctx bindings** — what `setup()` returns. Rewritten to `ctx.<name>`, so
 *    globals (Math, JSON, document, …) are left untouched.
 *  - **template locals** — framework-provided reactive values from `@for`
 *    (the loop item + `$index`/`$first`/…), `@let`, and `@if (…; as x)`. These
 *    read as plain values in the template (Angular-style) but are backed by
 *    accessors, so a reference like `todo` rewrites to `<accessor>()`.
 *
 * Everything else (globals, locally-bound arrow params, property names after
 * `.`) is left as-is. This is a lexical tokenizer, not a full JS parser; the
 * known edge cases (object shorthand, a binding reused as a local param) are
 * resolved in M8 with the TypeScript AST. Over-rewriting is the only risk and
 * it is rare.
 */

const ID_START: RegExp = /[A-Za-z_$]/;
const ID_CHAR: RegExp = /[A-Za-z0-9_$]/;

/** How a referenced name is resolved. */
export type Binding =
  | { kind: 'ctx' } // setup() binding → ctx.<name>
  | { kind: 'call'; accessor: string } // template local → <accessor>()
  | { kind: 'local' }; // a real lexical local — emit the bare name (used by `@weave-framework/check`)

export type Scope = Map<string, Binding>;

/**
 * A maximal run of characters copied **verbatim** from the source expression
 * into the generated code, identical in both (so `len` applies to each side).
 * Used by `@weave-framework/language-server` to build Volar's bidirectional source↔virtual
 * mappings: every source character is covered by exactly one segment, while
 * synthesized text (the `ctxRef.` prefix, an accessor `()`) is intentionally left
 * unmapped. Offsets are relative to the start of `expr` / `code` respectively.
 */
export interface RewriteSegment {
  /** offset into the source expression */
  src: number;
  /** offset into the generated `code` */
  gen: number;
  /** length of the verbatim run (same on both sides) */
  len: number;
}

export interface RewriteResult {
  code: string;
  /** whether any binding (ctx or local) was referenced ⇒ the expression is reactive */
  reactive: boolean;
  /** verbatim src↔gen runs, in generated order (for editor tooling source maps) */
  segments: RewriteSegment[];
}

/**
 * Rewrite `expr` against `scope`, prefixing ctx bindings with `ctxRef` (default
 * `ctx`, the runtime context object; `@weave-framework/check` passes `__ctx`, its typed
 * stand-in). Template locals emit either an accessor call (runtime) or the bare
 * name (`kind: 'local'`, the check pass where they are real lexical bindings).
 *
 * Alongside `code`, returns `segments` — the verbatim src↔gen character runs — so
 * editor tooling can map a position in the generated module back to the template.
 */
export function rewrite(expr: string, scope: Scope, ctxRef: string = 'ctx'): RewriteResult {
  let out: string = '';
  let reactive: boolean = false;
  let i: number = 0;
  const n: number = expr.length;

  // Arrow-function parameters are lexical locals, not ctx bindings — a template
  // expression like `items().map((value) => value * 2)` must NOT rewrite `value`
  // to `ctx.value` (which yields `(ctx.value) =>`, a syntax error) even when a
  // same-named ctx binding exists. Same basis as `freeIdentifiers`, so inference
  // and rewriting agree on what is a parameter.
  const params: Set<string> = arrowParams(expr);

  const segments: RewriteSegment[] = [];
  // The current verbatim run, contiguous in both source and generated text.
  let runSrc: number = -1;
  let runGen: number = -1;
  let runLen: number = 0;
  const flush = (): void => {
    if (runLen > 0) segments.push({ src: runSrc, gen: runGen, len: runLen });
    runLen = 0;
  };
  // Append `text` (== expr.slice(srcPos, srcPos+len)) verbatim, extending the
  // current run when it stays contiguous on both sides, else starting a new one.
  const copy = (srcPos: number, text: string): void => {
    const genPos: number = out.length;
    if (runLen > 0 && runSrc + runLen === srcPos && runGen + runLen === genPos) {
      runLen += text.length;
    } else {
      flush();
      runSrc = srcPos;
      runGen = genPos;
      runLen = text.length;
    }
    out += text;
  };
  // Append synthesized text that has no source counterpart (leaves a gen-side gap).
  const insert = (text: string): void => {
    flush();
    out += text;
  };

  while (i < n) {
    const c: string = expr[i];

    if (c === '"' || c === "'") {
      const end: number = scanString(expr, i);
      copy(i, expr.slice(i, end));
      i = end;
      continue;
    }

    if (c === '`') {
      // Template literal: copy the literal spans verbatim but rewrite each `${ … }` interpolation,
      // so a ctx/local binding inside `${ }` still resolves instead of being left a bare global.
      copy(i, '`');
      let k: number = i + 1;
      while (k < n) {
        const ch: string = expr[k];
        if (ch === '\\') {
          copy(k, expr.slice(k, k + 2));
          k += 2;
          continue;
        }
        if (ch === '`') {
          copy(k, '`');
          k++;
          break;
        }
        if (ch === '$' && expr[k + 1] === '{') {
          copy(k, '${');
          k += 2;
          const exprStart: number = k;
          let depth: number = 1;
          while (k < n && depth > 0) {
            const mc: string = expr[k];
            if (mc === '"' || mc === "'" || mc === '`') {
              k = scanString(expr, k);
              continue;
            }
            if (mc === '{') depth++;
            else if (mc === '}') {
              depth--;
              if (depth === 0) break;
            }
            k++;
          }
          const sub: RewriteResult = rewrite(expr.slice(exprStart, k), scope, ctxRef);
          if (sub.reactive) reactive = true;
          // Splice the rewritten interpolation in WITH its segments (offset into this expr/out), so
          // source coverage + the verbatim invariant hold through `${ … }` for editor tooling.
          flush();
          const genStart: number = out.length;
          for (const s of sub.segments) segments.push({ src: exprStart + s.src, gen: genStart + s.gen, len: s.len });
          out += sub.code;
          if (expr[k] === '}') {
            copy(k, '}');
            k++;
          }
          continue;
        }
        copy(k, ch);
        k++;
      }
      i = k;
      continue;
    }

    if (ID_START.test(c)) {
      let j: number = i + 1;
      while (j < n && ID_CHAR.test(expr[j])) j++;
      const name: string = expr.slice(i, j);
      // A member access (`obj.name`) leaves `name` verbatim — but a spread/rest `...name` also
      // ends in `.`, and there `name` IS a reference that must be scope-rewritten. Distinguish
      // the two: only a lone `.` is a property accessor; `...` is a spread.
      const isProperty: boolean = lastNonSpace(out) === '.' && !endsWithSpread(out);
      const binding: Binding | undefined = scope.get(name);

      // An explicit object-literal key (`{ key: … }` / `, key: …`) is a property name, not a
      // reference — leave it verbatim, exactly like a `.member` property. (Shorthand `{ key }` is
      // NOT matched here: `next` is `,`/`}`, so it still expands + rewrites below.)
      const prev: string = lastNonSpace(out);
      const next: string = firstNonSpaceFrom(expr, j);
      const isObjectKey: boolean = (prev === '{' || prev === ',') && next === ':';

      if (binding && !isProperty && !isObjectKey && !params.has(name)) {
        // `{ name }` object shorthand must expand to `{ name: <value> }` — a bare `{ ctx.name }` /
        // `{ accessor() }` is a syntax error. Detect a shorthand key: between `{`|`,` and `,`|`}`.
        if (binding.kind !== 'local') {
          if ((prev === '{' || prev === ',') && (next === ',' || next === '}')) insert(`${name}: `);
        }
        if (binding.kind === 'ctx') {
          insert(`${ctxRef}.`);
          copy(i, name);
        } else if (binding.kind === 'local') {
          copy(i, name);
        } else {
          insert(`${binding.accessor}()`);
        }
        reactive = true;
      } else {
        copy(i, name);
      }
      i = j;
      continue;
    }

    copy(i, c);
    i++;
  }
  flush();

  return { code: out, reactive, segments };
}

/** Build a scope from a list of ctx binding names. */
export function ctxScope(names: Iterable<string>): Scope {
  const scope: Scope = new Map();
  for (const name of names) scope.set(name, { kind: 'ctx' });
  return scope;
}

/** Derive a child scope, adding template-local accessors. */
export function childScope(parent: Scope, locals: Record<string, string>): Scope {
  const scope: Scope = new Map(parent);
  for (const [name, accessor] of Object.entries(locals)) {
    scope.set(name, { kind: 'call', accessor });
  }
  return scope;
}

function lastNonSpace(s: string): string {
  for (let i: number = s.length - 1; i >= 0; i--) {
    if (!/\s/.test(s[i])) return s[i];
  }
  return '';
}

/** Does `s` end (ignoring trailing whitespace) with a `...` spread/rest, not a member `.`? */
function endsWithSpread(s: string): boolean {
  let i: number = s.length - 1;
  while (i >= 0 && /\s/.test(s[i])) i--;
  return i >= 2 && s[i] === '.' && s[i - 1] === '.' && s[i - 2] === '.';
}

/** First non-whitespace character in `s` at or after `from` (''  if none). */
function firstNonSpaceFrom(s: string, from: number): string {
  for (let i: number = from; i < s.length; i++) {
    if (!/\s/.test(s[i])) return s[i];
  }
  return '';
}

/**
 * JS globals + keywords that a template expression may reference but that must
 * NOT be rewritten to `ctx.*`. Used by auto-scope inference (the loader): every
 * other free identifier is assumed to be component data. A lexical list now;
 * M8 replaces inference with the TypeScript AST (`ReturnType<typeof setup>`).
 */
const NON_CTX: Set<string> = new Set([
  // literals / keywords
  'true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity',
  'typeof', 'instanceof', 'in', 'of', 'new', 'void', 'delete', 'await', 'yield',
  'return', 'function', 'class', 'super', 'if', 'else', 'switch', 'case',
  // Declaration keywords + loop/flow words: a block-bodied expression (`computed(() => { const x = …; })`)
  // contains them, and reading them as component data produced nonsense like "reads `const`" (dogfound).
  'const', 'let', 'var', 'for', 'while', 'do', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  // `default` (a `switch` arm) is reserved, so it can never be a data name — it was reported as one.
  'default', 'async', 'extends', 'static', 'debugger',
  // built-in objects / functions
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Promise', 'BigInt',
  'Error', 'TypeError', 'Intl', 'console', 'window', 'document', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams',
  // timers / scheduling
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  // common DOM globals a handler may call inline
  'alert', 'confirm', 'prompt', 'performance', 'crypto',
  'Event', 'CustomEvent', 'AbortController', 'FormData', 'Blob', 'File',
  'Image', 'Audio', 'getComputedStyle', 'atob', 'btoa',
]);

/** Collect arrow-function parameter names in `expr` (so they aren't treated as ctx). */
function arrowParams(expr: string): Set<string> {
  const params: Set<string> = new Set<string>();
  const ID: RegExp = /^[A-Za-z_$][\w$]*$/;
  let at: number = expr.indexOf('=>');
  while (at !== -1) {
    let k: number = at - 1;
    while (k >= 0 && /\s/.test(expr[k])) k--;
    if (expr[k] === ')') {
      // (a, b, …) => …  — walk back to the matching '('
      let depth: number = 1;
      let m: number = k - 1;
      for (; m >= 0; m--) {
        if (expr[m] === ')') depth++;
        else if (expr[m] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      for (const raw of expr.slice(m + 1, k).split(',')) {
        const name: string = raw.trim().split(/[\s=:]/)[0].replace(/[{}[\]().]/g, '');
        if (ID.test(name)) params.add(name);
      }
    } else {
      // single bare param:  x => …
      let m: number = k;
      while (m >= 0 && ID_CHAR.test(expr[m])) m--;
      const name: string = expr.slice(m + 1, k + 1);
      if (ID.test(name)) params.add(name);
    }
    at = expr.indexOf('=>', at + 2);
  }
  return params;
}

/**
 * Free identifiers in `expr` that should resolve to component data: every name
 * that is not a property access, not a JS global/keyword, and not an arrow
 * parameter. The basis for auto-scope (see {@link inferCtxNames}).
 */
export function freeIdentifiers(expr: string): string[] {
  const out: Set<string> = new Set<string>();
  const params: Set<string> = arrowParams(expr);
  let i: number = 0;
  const n: number = expr.length;
  while (i < n) {
    const c: string = expr[i];
    if (c === '"' || c === "'") {
      i = scanString(expr, i);
      continue;
    }
    if (c === '`') {
      // Walk the template literal; recurse into each `${ … }` so identifiers there are collected too.
      let k: number = i + 1;
      while (k < n) {
        const ch: string = expr[k];
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === '`') {
          k++;
          break;
        }
        if (ch === '$' && expr[k + 1] === '{') {
          k += 2;
          const start: number = k;
          let depth: number = 1;
          while (k < n && depth > 0) {
            const mc: string = expr[k];
            if (mc === '"' || mc === "'" || mc === '`') {
              k = scanString(expr, k);
              continue;
            }
            if (mc === '{') depth++;
            else if (mc === '}') {
              depth--;
              if (depth === 0) break;
            }
            k++;
          }
          for (const id of freeIdentifiers(expr.slice(start, k))) out.add(id);
          continue;
        }
        k++;
      }
      i = k;
      continue;
    }
    if (ID_START.test(c)) {
      let j: number = i + 1;
      while (j < n && ID_CHAR.test(expr[j])) j++;
      const name: string = expr.slice(i, j);
      const before: string = expr.slice(0, i);
      const prev: string = lastNonSpace(before);
      const next: string = firstNonSpaceFrom(expr, j);
      // A member access (`obj.name`) is a property; a spread/rest (`...name`) also ends in `.` but
      // there `name` is a data reference that must be inferred as ctx (regression: a `use:` config
      // `{ ...opts, … }` failed to pull `opts` into scope, so it stayed a bare global).
      const isProperty: boolean = prev === '.' && !endsWithSpread(before);
      // An explicit object-literal key (`{ key: … }` / `, key: …`) is a property name, not component
      // data — don't infer it as ctx. Shorthand `{ key }` (next is `,`/`}`) IS a value ref → kept.
      const isObjectKey: boolean = (prev === '{' || prev === ',') && next === ':';
      if (!isProperty && !isObjectKey && !NON_CTX.has(name) && !params.has(name)) out.add(name);
      i = j;
      continue;
    }
    i++;
  }
  return [...out];
}

function scanString(s: string, start: number): number {
  const quote: string = s[start];
  let i: number = start + 1;
  while (i < s.length) {
    const c: string = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return s.length;
}
