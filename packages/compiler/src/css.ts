/**
 * Weave scoped CSS — compile-time attribute scoping (Svelte-proven, SSR-safe,
 * zero runtime cost). Each component's styles are hashed to an attribute
 * (`data-w-<hash>`); the compiler stamps that attribute on every element the
 * template emits (see codegen), and here we rewrite the CSS so each rule's
 * rightmost compound selector carries the same `[data-w-<hash>]` — so the styles
 * apply only to this component's elements.
 *
 * Hand-written tokenizer, no PostCSS. Handles: selector lists, descendant/child/
 * sibling combinators, pseudo-classes/elements, `:global(...)` (unwrapped, left
 * unscoped), native nesting (`&` and nested rules), `@media`/`@supports`/etc.
 * (recursed into), and `@keyframes` (name kept, frame selectors not scoped).
 */

/** The attribute a given hash scopes to (stamped on elements, matched in CSS). */
export function scopeAttr(hash: string): string {
  return `data-w-${hash}`;
}

/**
 * The attribute marking a component's *root* element(s) — what `:host` targets.
 * Weave has no shadow DOM, so `:host` resolves to the template roots (codegen
 * stamps this only when the CSS actually uses `:host`).
 */
export function hostAttr(hash: string): string {
  return `data-w-${hash}-h`;
}

/** Deterministic short hash (FNV-1a, base36) for a component's style+template. */
export function hashCss(input: string): string {
  let h: number = 0x811c9dc5;
  for (let i: number = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

/** Rewrite `css` so it only targets elements carrying `[data-w-<hash>]`. */
export function scopeCss(css: string, hash: string): string {
  return transformBlock(css, scopeAttr(hash), hostAttr(hash), false);
}

/* ──────────── block-level walk ──────────── */

function transformBlock(css: string, attr: string, host: string, keyframes: boolean): string {
  let out: string = '';
  let i: number = 0;
  const n: number = css.length;

  while (i < n) {
    const c: string = css[i];
    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }
    if (css.startsWith('/*', i)) {
      const end: number = css.indexOf('*/', i + 2);
      const stop: number = end === -1 ? n : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    // Read a statement prelude up to a top-level ';' (declaration / @import) or '{' (block).
    let j: number = i;
    let depth: number = 0;
    let kind: '' | 'decl' | 'block' = '';
    while (j < n) {
      const ch: string = css[j];
      if (ch === '"' || ch === "'") {
        j = skipString(css, j);
        continue;
      }
      if (css.startsWith('/*', j)) {
        const e: number = css.indexOf('*/', j + 2);
        j = e === -1 ? n : e + 2;
        continue;
      }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (depth === 0 && ch === '{') { kind = 'block'; break; }
      else if (depth === 0 && ch === ';') { kind = 'decl'; break; }
      j++;
    }

    if (kind === '') {
      out += css.slice(i); // trailing text (e.g. last declaration without ';')
      break;
    }

    const prelude: string = css.slice(i, j);
    if (kind === 'decl') {
      out += prelude + ';';
      i = j + 1;
      continue;
    }

    // Block: read its balanced body.
    const bodyStart: number = j + 1;
    let k: number = bodyStart;
    let bd: number = 1;
    while (k < n) {
      const ch: string = css[k];
      if (ch === '"' || ch === "'") {
        k = skipString(css, k);
        continue;
      }
      if (css.startsWith('/*', k)) {
        const e: number = css.indexOf('*/', k + 2);
        k = e === -1 ? n : e + 2;
        continue;
      }
      if (ch === '{') bd++;
      else if (ch === '}') {
        bd--;
        if (bd === 0) break;
      }
      k++;
    }
    const body: string = css.slice(bodyStart, k);
    const after: number = k < n ? k + 1 : n;
    const trimmed: string = prelude.trim();

    if (keyframes) {
      // Frame selector (`0%`, `from`, `to`) — never scoped; body is declarations.
      out += prelude + '{' + body + '}';
    } else if (trimmed.startsWith('@')) {
      const kw: string = (/^@-?\w[\w-]*/.exec(trimmed)?.[0] ?? '').toLowerCase();
      if (kw.endsWith('keyframes')) {
        out += prelude + '{' + transformBlock(body, attr, host, true) + '}';
      } else if (kw === '@font-face' || kw === '@page' || kw === '@property' || kw === '@counter-style') {
        out += prelude + '{' + body + '}'; // declarations only — nothing to scope
      } else {
        out += prelude + '{' + transformBlock(body, attr, host, false) + '}'; // @media/@supports/@container/@layer…
      }
    } else {
      out += scopeSelectorList(prelude, attr, host) + '{' + transformBlock(body, attr, host, false) + '}';
    }
    i = after;
  }
  return out;
}

/* ──────────── selector scoping ──────────── */

function scopeSelectorList(prelude: string, attr: string, host: string): string {
  return splitTopLevel(prelude, ',')
    .map((s) => scopeSelector(s, attr, host))
    .join(', ');
}

function scopeSelector(raw: string, attr: string, host: string): string {
  const sel: string = raw.trim();
  if (!sel) return sel;

  const start: number = rightmostCompoundStart(sel);
  // `:host` may appear in an ancestor position (`:host .child`) — rewrite it there too.
  const prefix: string = rewriteHost(unwrapGlobal(sel.slice(0, start)), host);
  const right: string = sel.slice(start);
  const rightTrim: string = right.trim();

  // The rightmost compound is `:host` / `:host(.x)` → carries the host attr, not
  // the normal element scope (a root is matched by where it is, not what it is).
  if (rightTrim.startsWith(':host')) {
    return prefix + rewriteHost(unwrapGlobal(right), host);
  }
  // `:global(...)` rightmost compound or a nesting `&` already carry/inherit scope.
  if (rightTrim.startsWith(':global(') || right.includes('&')) {
    return prefix + unwrapGlobal(right);
  }
  return prefix + insertAttr(unwrapGlobal(right), attr);
}

/**
 * Rewrite `:host` / `:host(<sel>)` tokens to the host attribute. `:host` →
 * `[host]`; `:host(.active)` → `.active[host]` (Angular semantics). Leaves
 * unrelated tokens (and `:host-context(...)`, not supported) untouched.
 */
function rewriteHost(s: string, host: string): string {
  let out: string = '';
  let i: number = 0;
  while (i < s.length) {
    if (s.startsWith(':host', i)) {
      const after: string = s[i + 5];
      if (after === '(') {
        let depth: number = 1;
        let j: number = i + 6;
        let inner: string = '';
        while (j < s.length && depth > 0) {
          const c: string = s[j];
          if (c === '(') depth++;
          else if (c === ')' && --depth === 0) { j++; break; }
          inner += c;
          j++;
        }
        out += inner.trim() + `[${host}]`;
        i = j;
        continue;
      }
      // A bare `:host` token (not `:host-context` or `:hostfoo`).
      if (after === undefined || !/[-\w]/.test(after)) {
        out += `[${host}]`;
        i += 5;
        continue;
      }
    }
    out += s[i++];
  }
  return out;
}

/** Index in `sel` where the rightmost compound selector begins (after the last combinator). */
function rightmostCompoundStart(sel: string): number {
  let depth: number = 0;
  let start: number = 0;
  let i: number = 0;
  while (i < sel.length) {
    const c: string = sel[i];
    if (c === '(' || c === '[') {
      depth++;
      i++;
      continue;
    }
    if (c === ')' || c === ']') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      if (c === '>' || c === '+' || c === '~') {
        i++;
        while (i < sel.length && /\s/.test(sel[i])) i++;
        start = i;
        continue;
      }
      if (/\s/.test(c)) {
        let j: number = i;
        while (j < sel.length && /\s/.test(sel[j])) j++;
        const next: string = sel[j];
        if (j >= sel.length) { i = j; continue; } // trailing space
        if (next === '>' || next === '+' || next === '~') { i = j; continue; } // space around a combinator
        start = j; // descendant combinator
        i = j;
        continue;
      }
    }
    i++;
  }
  return start;
}

/** Insert `[attr]` into a compound selector before its first top-level pseudo (`:`), else append. */
function insertAttr(compound: string, attr: string): string {
  let depth: number = 0;
  for (let i: number = 0; i < compound.length; i++) {
    const c: string = compound[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === ':') {
      return compound.slice(0, i) + `[${attr}]` + compound.slice(i);
    }
  }
  return compound + `[${attr}]`;
}

/** Replace every `:global(X)` with `X` (parens balanced). */
function unwrapGlobal(s: string): string {
  let out: string = '';
  let i: number = 0;
  while (i < s.length) {
    if (s.startsWith(':global(', i)) {
      i += ':global('.length;
      let depth: number = 1;
      while (i < s.length && depth > 0) {
        const c: string = s[i];
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        out += c;
        i++;
      }
    } else {
      out += s[i++];
    }
  }
  return out;
}

/* ──────────── shared scanners ──────────── */

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let last: number = 0;
  for (let i: number = 0; i < s.length; i++) {
    const c: string = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

/** Skip a quoted string starting at `start`; returns the index just past the closing quote. */
function skipString(s: string, start: number): number {
  const q: string = s[start];
  let i: number = start + 1;
  while (i < s.length) {
    const c: string = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return s.length;
}
