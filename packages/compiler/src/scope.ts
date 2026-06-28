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
  | { kind: 'call'; accessor: string }; // template local → <accessor>()

export type Scope = Map<string, Binding>;

export interface RewriteResult {
  code: string;
  /** whether any binding (ctx or local) was referenced ⇒ the expression is reactive */
  reactive: boolean;
}

export function rewrite(expr: string, scope: Scope): RewriteResult {
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
        out += binding.kind === 'ctx' ? `ctx.${name}` : `${binding.accessor}()`;
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
