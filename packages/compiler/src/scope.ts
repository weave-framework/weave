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

const ID_START = /[A-Za-z_$]/;
const ID_CHAR = /[A-Za-z0-9_$]/;

/** How a referenced name is resolved. */
export type Binding =
  | { kind: 'ctx' } // setup() binding → ctx.<name>
  | { kind: 'call'; accessor: string } // template local → <accessor>()
  | { kind: 'local' }; // a real lexical local — emit the bare name (used by `@weave/check`)

export type Scope = Map<string, Binding>;

export interface RewriteResult {
  code: string;
  /** whether any binding (ctx or local) was referenced ⇒ the expression is reactive */
  reactive: boolean;
}

/**
 * Rewrite `expr` against `scope`, prefixing ctx bindings with `ctxRef` (default
 * `ctx`, the runtime context object; `@weave/check` passes `__ctx`, its typed
 * stand-in). Template locals emit either an accessor call (runtime) or the bare
 * name (`kind: 'local'`, the check pass where they are real lexical bindings).
 */
export function rewrite(expr: string, scope: Scope, ctxRef = 'ctx'): RewriteResult {
  let out = '';
  let reactive = false;
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const c = expr[i];

    if (c === '"' || c === "'" || c === '`') {
      const end = scanString(expr, i);
      out += expr.slice(i, end);
      i = end;
      continue;
    }

    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_CHAR.test(expr[j])) j++;
      const name = expr.slice(i, j);
      const isProperty = lastNonSpace(out) === '.';
      const binding = scope.get(name);

      if (binding && !isProperty) {
        out +=
          binding.kind === 'ctx'
            ? `${ctxRef}.${name}`
            : binding.kind === 'local'
              ? name
              : `${binding.accessor}()`;
        reactive = true;
      } else {
        out += name;
      }
      i = j;
      continue;
    }

    out += c;
    i++;
  }

  return { code: out, reactive };
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
  for (let i = s.length - 1; i >= 0; i--) {
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
const NON_CTX = new Set([
  // literals / keywords
  'true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity',
  'typeof', 'instanceof', 'in', 'of', 'new', 'void', 'delete', 'await', 'yield',
  'return', 'function', 'class', 'super', 'if', 'else', 'switch', 'case',
  // built-in objects / functions
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Promise', 'BigInt',
  'Error', 'TypeError', 'Intl', 'console', 'window', 'document', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams',
]);

/** Collect arrow-function parameter names in `expr` (so they aren't treated as ctx). */
function arrowParams(expr: string): Set<string> {
  const params = new Set<string>();
  const ID = /^[A-Za-z_$][\w$]*$/;
  let at = expr.indexOf('=>');
  while (at !== -1) {
    let k = at - 1;
    while (k >= 0 && /\s/.test(expr[k])) k--;
    if (expr[k] === ')') {
      // (a, b, …) => …  — walk back to the matching '('
      let depth = 1;
      let m = k - 1;
      for (; m >= 0; m--) {
        if (expr[m] === ')') depth++;
        else if (expr[m] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      for (const raw of expr.slice(m + 1, k).split(',')) {
        const name = raw.trim().split(/[\s=:]/)[0].replace(/[{}[\]().]/g, '');
        if (ID.test(name)) params.add(name);
      }
    } else {
      // single bare param:  x => …
      let m = k;
      while (m >= 0 && ID_CHAR.test(expr[m])) m--;
      const name = expr.slice(m + 1, k + 1);
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
  const out = new Set<string>();
  const params = arrowParams(expr);
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') {
      i = scanString(expr, i);
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_CHAR.test(expr[j])) j++;
      const name = expr.slice(i, j);
      const isProperty = lastNonSpace(expr.slice(0, i)) === '.';
      if (!isProperty && !NON_CTX.has(name) && !params.has(name)) out.add(name);
      i = j;
      continue;
    }
    i++;
  }
  return [...out];
}

function scanString(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return s.length;
}
