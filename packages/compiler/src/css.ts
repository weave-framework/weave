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

/** Deterministic short hash (FNV-1a, base36) for a component's style+template. */
export function hashCss(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

/** Rewrite `css` so it only targets elements carrying `[data-w-<hash>]`. */
export function scopeCss(css: string, hash: string): string {
  return transformBlock(css, scopeAttr(hash), false);
}

/* ──────────── block-level walk ──────────── */

function transformBlock(css: string, attr: string, keyframes: boolean): string {
  let out = '';
  let i = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i];
    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    // Read a statement prelude up to a top-level ';' (declaration / @import) or '{' (block).
    let j = i;
    let depth = 0;
    let kind: '' | 'decl' | 'block' = '';
    while (j < n) {
      const ch = css[j];
      if (ch === '"' || ch === "'") {
        j = skipString(css, j);
        continue;
      }
      if (css.startsWith('/*', j)) {
        const e = css.indexOf('*/', j + 2);
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

    const prelude = css.slice(i, j);
    if (kind === 'decl') {
      out += prelude + ';';
      i = j + 1;
      continue;
    }

    // Block: read its balanced body.
    const bodyStart = j + 1;
    let k = bodyStart;
    let bd = 1;
    while (k < n) {
      const ch = css[k];
      if (ch === '"' || ch === "'") {
        k = skipString(css, k);
        continue;
      }
      if (css.startsWith('/*', k)) {
        const e = css.indexOf('*/', k + 2);
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
    const body = css.slice(bodyStart, k);
    const after = k < n ? k + 1 : n;
    const trimmed = prelude.trim();

    if (keyframes) {
      // Frame selector (`0%`, `from`, `to`) — never scoped; body is declarations.
      out += prelude + '{' + body + '}';
    } else if (trimmed.startsWith('@')) {
      const kw = (/^@-?\w[\w-]*/.exec(trimmed)?.[0] ?? '').toLowerCase();
      if (kw.endsWith('keyframes')) {
        out += prelude + '{' + transformBlock(body, attr, true) + '}';
      } else if (kw === '@font-face' || kw === '@page' || kw === '@property' || kw === '@counter-style') {
        out += prelude + '{' + body + '}'; // declarations only — nothing to scope
      } else {
        out += prelude + '{' + transformBlock(body, attr, false) + '}'; // @media/@supports/@container/@layer…
      }
    } else {
      out += scopeSelectorList(prelude, attr) + '{' + transformBlock(body, attr, false) + '}';
    }
    i = after;
  }
  return out;
}

/* ──────────── selector scoping ──────────── */

function scopeSelectorList(prelude: string, attr: string): string {
  return splitTopLevel(prelude, ',')
    .map((s) => scopeSelector(s, attr))
    .join(', ');
}

function scopeSelector(raw: string, attr: string): string {
  const sel = raw.trim();
  if (!sel) return sel;

  const start = rightmostCompoundStart(sel);
  const prefix = unwrapGlobal(sel.slice(0, start));
  const right = sel.slice(start);
  const rightTrim = right.trim();

  // `:global(...)` rightmost compound or a nesting `&` already carry/inherit scope.
  if (rightTrim.startsWith(':global(') || right.includes('&')) {
    return prefix + unwrapGlobal(right);
  }
  return prefix + insertAttr(unwrapGlobal(right), attr);
}

/** Index in `sel` where the rightmost compound selector begins (after the last combinator). */
function rightmostCompoundStart(sel: string): number {
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < sel.length) {
    const c = sel[i];
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
        let j = i;
        while (j < sel.length && /\s/.test(sel[j])) j++;
        const next = sel[j];
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
  let depth = 0;
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i];
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
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith(':global(', i)) {
      i += ':global('.length;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const c = s[i];
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
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
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
  const q = s[start];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return s.length;
}
