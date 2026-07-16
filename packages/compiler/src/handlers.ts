/**
 * Named-handler resume (Phase E, E1.5) — make `on:click={{ inc }}` resumable.
 *
 * An INLINE handler already resumes: its body is written in the template, so the compiler emits it into the
 * `handlers(ctx)` factory rewritten against the resumed ctx (`{ w0: () => ctx.count.set(n => n + 1) }`). A
 * NAMED handler does not: the template only carries the name, the body lives in `setup` (which never re-runs
 * on the client), and `inc` itself is stripped from the snapshot (an unclaimed function can't serialize) — so
 * the factory's `{ w0: ctx.inc }` resolves to `undefined` and the button is inert.
 *
 * The fix is compile-time inlining: pull `inc`'s definition out of the `setup` source and hand its body to the
 * SAME `rewrite()` the inline form goes through, so both produce identical factory code. No new parser — this
 * reuses `scope.ts` (`freeIdentifiers`, and `rewrite` at the call site) and `auto-return.ts`'s opaque-aware
 * scanner primitives, which already handle strings/comments/regex and arrow params.
 *
 * FAIL-SAFE by construction (mirrors `injectAutoReturn`): a handler is inlined ONLY when it is located with
 * confidence AND {@link isInlinable} proves every free identifier resolves on the client. Anything else — a
 * non-ctx setup local, a call to another setup helper, a reassigned/computed binding — is left alone, so the
 * emit falls back to today's `ctx.<name>` (inert on resume, never a crash) and the caller warns.
 */

import { freeIdentifiers } from './scope.js';
import { matchDelimited, skipOpaque, skipWs, startsWithWord } from './auto-return.js';

const SETUP_FN: RegExp = /export\s+(?:async\s+)?function\s+setup\b/;
const SETUP_VAR: RegExp = /export\s+(?:const|let|var)\s+setup\s*=/;

/**
 * Offset of `setup`'s body-opening `{`, or null when it can't be located with confidence.
 *
 * Deliberately NOT `auto-return.ts`'s locator: that one bails on a return-TYPE annotation (correctly — an
 * annotated setup already returns explicitly, so it has no `return` to inject). Handler extraction must see
 * through the annotation, because `export function setup(): { count: Signal<number> } { … }` is the idiomatic
 * TS form — bailing there would silently skip inlining for most real components.
 *
 * The annotation is walked type-aware: an object type's `{ … }` is matched whole (its `;`/`=>` are type
 * syntax, not code), `<>`/`()`/`[]` nest, and a `{ … }` followed by another `{` means the first was the type
 * and the second is the body. Anything ambiguous returns null → no inlining (fail-safe), never a guess.
 */
function locateSetupBody(src: string): number | null {
  const fn: RegExpExecArray | null = SETUP_FN.exec(src);
  const v: RegExpExecArray | null = fn ? null : SETUP_VAR.exec(src);
  if (!fn && !v) return null;

  let i: number;
  if (fn) {
    i = skipWs(src, fn.index + fn[0].length);
  } else {
    i = skipWs(src, v!.index + v![0].length);
    if (startsWithWord(src, i, 'async')) i = skipWs(src, i + 5);
    if (startsWithWord(src, i, 'function')) i = skipWs(src, i + 8);
    else {
      // An arrow: `setup = (props): T => { … }` / `setup = () => { … }`. A concise body (`=> ({ … })`)
      // has no statements to scan, so it yields null.
      if (src[i] !== '(') return null;
      const rp: number = matchDelimited(src, i, '(', ')');
      if (rp < 0) return null;
      const arrow: number = findArrowAfterType(src, rp + 1);
      if (arrow < 0) return null;
      const b: number = skipWs(src, arrow + 2);
      return src[b] === '{' ? b : null;
    }
  }
  if (src[i] !== '(') return null;
  const rp: number = matchDelimited(src, i, '(', ')');
  if (rp < 0) return null;
  return bodyAfterReturnType(src, rp + 1);
}

/** From just past `)`, find the body `{` — skipping an optional `: Type` return annotation. */
function bodyAfterReturnType(src: string, from: number): number | null {
  let i: number = skipWs(src, from);
  if (src[i] === '{') return i; // no annotation
  if (src[i] !== ':') return null;
  i++;
  let depth: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    // `=>` is one token — its `>` is not a closing angle bracket (a fn-type annotation contains arrows).
    if (c === '=' && src[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    else if (depth === 0 && c === '{') {
      const close: number = matchDelimited(src, i, '{', '}');
      if (close < 0) return null;
      const next: number = skipWs(src, close + 1);
      const nc: string = src[next] ?? '';
      if (nc === '|' || nc === '&') {
        i = next + 1; // a union/intersection of object types — that `{ … }` was still the type
        continue;
      }
      if (nc === '{') return next; // `{type} {body}`
      return i; // this brace IS the body (the annotation was a named type)
    } else if (depth === 0 && (c === ';' || c === '=')) return null; // ran past the signature — bail
    i++;
  }
  return null;
}

/** From just past an arrow's `)`, skip an optional `: Type` and return the `=>` offset (-1 if none). */
function findArrowAfterType(src: string, from: number): number {
  let i: number = skipWs(src, from);
  let depth: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    // An `=>` must be consumed as ONE token: its `>` is not a closing angle bracket. A type-level arrow
    // (`{ inc: () => void }`) sits at depth > 0; the arrow we want is the one at depth 0.
    if (c === '=' && src[i + 1] === '>') {
      if (depth === 0) return i;
      i += 2;
      continue;
    }
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ';') return -1;
    i++;
  }
  return -1;
}

const ID_START: RegExp = /[A-Za-z_$]/;
const ID_CHAR: RegExp = /[A-Za-z0-9_$]/;

/** A `setup` binding that is shaped like an event handler (a function), extracted for inlining. */
export interface SetupHandler {
  /** The definition normalized to a callable EXPRESSION — an arrow, or an anonymous `function (…) { … }`. */
  source: string;
  /** Parameter names the handler itself binds. Locals, not ctx — subtracted from the free-identifier check. */
  params: string[];
}

/**
 * A `setup` binding declared as `computed(…)` (E1.6), extracted so the client can RE-DERIVE it.
 *
 * A computed is a bare getter with no writable surface, so the signal codec doesn't claim it and
 * `registerState` drops it — but unlike a handler, the template CALLS it (`{{ doubled() }}`), so a resumed
 * `ctx.doubled` of `undefined` throws and takes the whole page's resume down with it. The compiler therefore
 * emits a `derive(ctx)` that rebuilds each computed over the resumed ctx before adopt runs.
 */
export interface SetupComputed {
  /** The full `computed(…)` call source — what the free-identifier check reads. */
  source: string;
  /**
   * Just the ARGUMENTS, i.e. the text inside `computed( … )`. The emit re-attaches the callee itself via the
   * codegen's core-import reference (`computed` in module mode, `rt.computed` in function mode), so the user's
   * bare `computed` name is never emitted — it would be undefined in a `new Function` body.
   */
  args: string;
}

/** Every extractable top-level `setup` binding, split by shape. */
export interface SetupBindings {
  /** `const inc = () => …` — event handlers (E1.5). */
  handlers: Map<string, SetupHandler>;
  /** `const doubled = computed(() => …)` — re-derived on resume (E1.6). Insertion order = source order,
   *  which is also dependency order (a computed can only read one declared before it). */
  computeds: Map<string, SetupComputed>;
}

/** The callee of a re-derivable binding — excluded from the free-identifier check (the emit imports it). */
export const COMPUTED_CALLEE: string = 'computed';

/**
 * The ctx keys `setup` explicitly returns (`return { count, inc, doubled: d }` → `count`, `inc`, `doubled`),
 * or null when it can't be read: no top-level `return`, a non-object-literal return, or a spread (`...base`,
 * an extension component) whose full key set isn't statically known. Null means "fall back to template scope".
 *
 * Why it matters: a signal RETURNED but not referenced in the template (mutated only by a handler, shown only
 * via a computed) is still serialized and thus resolvable on the client — but it isn't in the template-inferred
 * scope. Without this, such a handler is wrongly refused (and any warning blames a name that is actually fine).
 */
export function extractReturnedNames(script: string): Set<string> | null {
  const open: number | null = locateSetupBody(script);
  if (open === null) return null;
  const close: number = matchDelimited(script, open, '{', '}');
  if (close < 0) return null;

  let i: number = open + 1;
  let depth: number = 0;
  while (i < close) {
    const op: number = skipOpaque(script, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = script[i];
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
    if (depth === 0 && ID_START.test(c) && isTokenStart(script, i) && startsWithWord(script, i, 'return')) {
      const b: number = skipWs(script, i + 6);
      if (script[b] !== '{') return null; // `return x` / `return;` — not a plain object literal
      const rb: number = matchDelimited(script, b, '{', '}');
      if (rb < 0) return null;
      return objectKeys(script.slice(b + 1, rb));
    }
    i = ID_START.test(c) && isTokenStart(script, i) ? skipWord(script, i) : i + 1;
  }
  return null; // no explicit return → auto-return synthesizes `{ …templateScope }`, so scope is the truth
}

/** Keys of an object-literal body (`a, b: x, [k]: y, ...s`). Null if a spread or computed key makes it unknown. */
function objectKeys(body: string): Set<string> | null {
  const out: Set<string> = new Set();
  for (const raw of splitTopLevel(body)) {
    const entry: string = raw.trim();
    if (!entry) continue;
    if (entry.startsWith('...')) return null; // a spread — the full key set isn't statically known
    if (entry.startsWith('[')) return null; // a computed key — unknown
    const key: string = entry.split(':')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(key)) out.add(key);
    else return null; // anything unexpected → be conservative
  }
  return out;
}

/**
 * Extract every top-level `setup` binding whose initializer is a function, keyed by name:
 * `const inc = (…) => …` · `const inc = function (…) { … }` · `function inc(…) { … }` (incl. `async`).
 *
 * Only the top level of `setup`'s own body is scanned (a nested helper is not a component binding), and only
 * simple single-definition forms are recognised — a reassigned `let`, a destructured or computed binding, and
 * anything the scanner can't bound confidently are skipped rather than guessed at. Returns an empty map when
 * `setup`'s body can't be located (a concise arrow body, an annotated signature) — the fail-safe path.
 */
export function extractSetupHandlers(script: string): Map<string, SetupHandler> {
  return extractSetupBindings(script).handlers;
}

/**
 * The one-pass scanner behind {@link extractSetupHandlers}: every top-level `setup` binding, split into
 * handlers (`const inc = () => …`, `function inc(){}`, incl. `async`) and computeds (`const doubled =
 * computed(() => …)`). Same fail-safe contract — an unlocatable body, a reassigned/destructured/computed
 * binding, or a nested helper yields nothing rather than a guess.
 */
export function extractSetupBindings(script: string): SetupBindings {
  const out: Map<string, SetupHandler> = new Map();
  const computeds: Map<string, SetupComputed> = new Map();
  const empty: SetupBindings = { handlers: out, computeds };
  const open: number | null = locateSetupBody(script);
  if (open === null) return empty;
  const close: number = matchDelimited(script, open, '{', '}');
  if (close < 0) return empty;

  let i: number = open + 1;
  let depth: number = 0; // nesting INSIDE the body — only depth 0 is a top-level statement
  while (i < close) {
    const op: number = skipOpaque(script, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = script[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth !== 0 || !ID_START.test(c) || !isTokenStart(script, i)) {
      i++;
      continue;
    }

    // `function inc(…) { … }` — a top-level declaration.
    if (startsWithWord(script, i, 'function')) {
      const parsed: { name: string; handler: SetupHandler; end: number } | null = readFunctionDecl(script, i);
      if (parsed) {
        out.set(parsed.name, parsed.handler);
        i = parsed.end;
        continue;
      }
    }
    // `async function inc(…) { … }`
    if (startsWithWord(script, i, 'async') && startsWithWord(script, skipWs(script, i + 5), 'function')) {
      const at: number = skipWs(script, i + 5);
      const parsed: { name: string; handler: SetupHandler; end: number } | null = readFunctionDecl(script, at);
      if (parsed) {
        out.set(parsed.name, { source: 'async ' + parsed.handler.source, params: parsed.handler.params });
        i = parsed.end;
        continue;
      }
    }
    // `const inc = <initializer>` (also let/var — but only when never reassigned; see below).
    if (startsWithWord(script, i, 'const') || startsWithWord(script, i, 'let') || startsWithWord(script, i, 'var')) {
      const kwLen: number = startsWithWord(script, i, 'const') ? 5 : startsWithWord(script, i, 'let') ? 3 : 3;
      const parsed: { name: string; init: string; end: number } | null = readVarDecl(script, i, kwLen);
      if (parsed) {
        const handler: SetupHandler | null = asFunctionExpr(parsed.init);
        if (handler) out.set(parsed.name, handler);
        else {
          const c: SetupComputed | null = asComputedCall(parsed.init);
          if (c) computeds.set(parsed.name, c);
        }
        i = parsed.end;
        continue;
      }
    }
    i = skipWord(script, i);
  }

  // A binding reassigned anywhere in the body is not a stable definition — drop it rather than inline a stale body.
  for (const name of [...out.keys()]) {
    if (isReassigned(script, open, close, name)) out.delete(name);
  }
  for (const name of [...computeds.keys()]) {
    if (isReassigned(script, open, close, name)) computeds.delete(name);
  }
  return empty;
}

/** `computed( … )` at `init` → its source + args. Null for anything else (an aliased import is not
 *  recognised — fail-safe: no derive, rather than a wrong one). */
function asComputedCall(init: string): SetupComputed | null {
  const src: string = init.trim();
  if (!startsWithWord(src, 0, COMPUTED_CALLEE)) return null;
  const p: number = skipWs(src, COMPUTED_CALLEE.length);
  if (src[p] !== '(') return null;
  const rp: number = matchDelimited(src, p, '(', ')');
  if (rp !== src.length - 1) return null; // the whole initializer must BE the call (not `computed(…).x`)
  return { source: src, args: src.slice(p + 1, rp) };
}

/**
 * Can `computed`'s body be re-derived over the resumed ctx? Same rule as {@link isInlinable}, minus the
 * callee itself (`computed` is imported by the emitted `derive`, not read from ctx) and its own name.
 * `resolvable` must include the computeds declared BEFORE this one — a computed may read an earlier one.
 */
export function isDerivable(computed: SetupComputed, resolvable: ReadonlySet<string>, name?: string): boolean {
  return unresolvedRefs(computed.source, resolvable, [], name, COMPUTED_CALLEE).length === 0;
}

/**
 * Can `handler`'s body be inlined into the `handlers(ctx)` factory and still resolve on the client?
 *
 * True when every free identifier it references is a ctx binding (rebuilt from the snapshot). `freeIdentifiers`
 * already drops JS globals and arrow parameters; this additionally subtracts the handler's OWN parameters (a
 * `function (e) { … }` form binds them outside any arrow) and its own name (self-reference / recursion).
 * A leftover name is a `setup` local that does NOT survive to the client (`const step = 2`, a helper fn) — so
 * inlining it would throw a ReferenceError on the first click. Refuse instead.
 */
export function isInlinable(handler: SetupHandler, ctxNames: ReadonlySet<string>, name?: string): boolean {
  return unresolvedRefs(handler.source, ctxNames, handler.params, name).length === 0;
}

/**
 * The free identifiers in `source` that would NOT resolve on the resumed client — i.e. exactly why
 * {@link isInlinable} / {@link isDerivable} refused. Each is a `setup` local that never crosses the snapshot
 * (a plain local, a helper fn, another handler, a non-derivable computed). Empty ⇒ safe to emit.
 *
 * The caller turns these into a build warning naming the culprit, so a silently-dead handler becomes a
 * message the author can act on.
 */
export function unresolvedRefs(
  source: string,
  ctxNames: ReadonlySet<string>,
  params: readonly string[] = [],
  name?: string,
  ignore?: string,
): string[] {
  const out: string[] = [];
  for (const id of freeIdentifiers(source)) {
    if (id === name || id === ignore) continue; // self-reference, or the emitted callee (`computed`)
    if (params.includes(id)) continue; // its own parameter (a local)
    if (!ctxNames.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/* ──────────── internals ──────────── */

/** Is `i` the start of a token (not the middle of an identifier)? */
function isTokenStart(src: string, i: number): boolean {
  return i === 0 || !ID_CHAR.test(src[i - 1]);
}

/** Advance past the identifier at `i`. */
function skipWord(src: string, i: number): number {
  let j: number = i;
  while (j < src.length && ID_CHAR.test(src[j])) j++;
  return j > i ? j : i + 1;
}

/** Read the identifier at `i` ('' when none). */
function readIdent(src: string, i: number): string {
  if (!ID_START.test(src[i] ?? '')) return '';
  let j: number = i + 1;
  while (j < src.length && ID_CHAR.test(src[j])) j++;
  return src.slice(i, j);
}

/** Split a `( … )` parameter list into simple names (a destructured/defaulted param yields its head token). */
function paramNames(list: string): string[] {
  const out: string[] = [];
  for (const raw of splitTopLevel(list)) {
    const name: string = raw.trim().split(/[\s=:]/)[0].replace(/[{}[\]().]/g, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
  }
  return out;
}

/** Split on top-level commas (ignoring nested delimiters + opaque regions). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let start: number = 0;
  let i: number = 0;
  while (i < s.length) {
    const op: number = skipOpaque(s, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

/** `function inc(a, b) { … }` at `i` → its name, an ANONYMOUS function-expression source, and the end offset. */
function readFunctionDecl(src: string, i: number): { name: string; handler: SetupHandler; end: number } | null {
  let k: number = skipWs(src, i + 8); // past `function`
  if (src[k] === '*') return null; // a generator is not a handler
  const name: string = readIdent(src, k);
  if (!name) return null;
  k = skipWs(src, k + name.length);
  if (src[k] !== '(') return null;
  const rp: number = matchDelimited(src, k, '(', ')');
  if (rp < 0) return null;
  const params: string[] = paramNames(src.slice(k + 1, rp));
  const bodyOpen: number = skipWs(src, rp + 1);
  if (src[bodyOpen] !== '{') return null; // a return-type annotation → fail-safe skip
  const bodyClose: number = matchDelimited(src, bodyOpen, '{', '}');
  if (bodyClose < 0) return null;
  // Emit WITHOUT the name: the factory needs a value expression, and dropping the name also keeps the
  // free-identifier scan from seeing the declaration as a reference to itself.
  const source: string = `function (${src.slice(k + 1, rp)}) ${src.slice(bodyOpen, bodyClose + 1)}`;
  return { name, handler: { source, params }, end: bodyClose + 1 };
}

/** `const inc = <init>;` at `i` → its name, the initializer source, and the end offset. */
function readVarDecl(src: string, i: number, kwLen: number): { name: string; init: string; end: number } | null {
  let k: number = skipWs(src, i + kwLen);
  const name: string = readIdent(src, k);
  if (!name) return null; // destructuring (`const { a } = …`) → not a simple binding
  k = skipWs(src, k + name.length);
  // A type annotation (`const inc: () => void = …`) — skip to the `=` at depth 0.
  if (src[k] === ':') {
    const eq: number = findTopLevel(src, k, '=');
    if (eq < 0) return null;
    k = eq;
  }
  if (src[k] !== '=' || src[k + 1] === '=' || src[k + 1] === '>') return null;
  const start: number = skipWs(src, k + 1);
  const end: number = declEnd(src, start);
  if (end < 0) return null;
  return { name, init: src.slice(start, end).trim(), end };
}

/** Offset of the first top-level `ch` at or after `i` (stops at a statement end). -1 if none. */
function findTopLevel(src: string, i: number, ch: string): number {
  let depth: number = 0;
  while (i < src.length) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0 && c === ch) return i;
    else if (depth === 0 && c === ';') return -1;
    i++;
  }
  return -1;
}

/** End of a declaration's initializer starting at `i`: the top-level `;`/`,`, or the end of the line. */
function declEnd(src: string, i: number): number {
  let depth: number = 0;
  while (i < src.length) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i; // ran into the enclosing body's `}` — the initializer ends here
      depth--;
    } else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && c === '\n') {
      // ASI: a newline ends the initializer unless the next real token continues the expression.
      const next: number = skipWs(src, i);
      const nc: string = src[next] ?? '';
      if (nc !== '.' && nc !== '?' && nc !== ')' && nc !== ']') return i;
    }
    i++;
  }
  return src.length;
}

/** Is `init` a function expression (arrow / `function`)? Returns it normalized, else null. */
function asFunctionExpr(init: string): SetupHandler | null {
  const src: string = init.trim();
  let k: number = 0;
  let isAsync: boolean = false;
  if (startsWithWord(src, 0, 'async')) {
    isAsync = true;
    k = skipWs(src, 5);
  }
  // `function (…) { … }`
  if (startsWithWord(src, k, 'function')) {
    let p: number = skipWs(src, k + 8);
    if (src[p] === '*') return null;
    const name: string = readIdent(src, p);
    if (name) p = skipWs(src, p + name.length);
    if (src[p] !== '(') return null;
    const rp: number = matchDelimited(src, p, '(', ')');
    if (rp < 0) return null;
    return { source: src, params: paramNames(src.slice(p + 1, rp)) };
  }
  // `(a, b) => …`
  if (src[k] === '(') {
    const rp: number = matchDelimited(src, k, '(', ')');
    if (rp < 0) return null;
    const after: number = skipWs(src, rp + 1);
    // A return-type annotation (`(): void => …`) sits between `)` and `=>` — accept it, the source is emitted verbatim.
    const arrowAt: number = src[after] === ':' ? findTopLevel(src, after, '=') : after;
    if (arrowAt < 0 || src[arrowAt] !== '=' || src[arrowAt + 1] !== '>') return null;
    return { source: src, params: paramNames(src.slice(k + 1, rp)) };
  }
  // `x => …` (a single bare parameter)
  const bare: string = readIdent(src, k);
  if (bare) {
    const after: number = skipWs(src, k + bare.length);
    if (src[after] === '=' && src[after + 1] === '>') return { source: src, params: [bare] };
  }
  // Anything else (a signal, a value, a call result) is not a handler. `isAsync` only matters for the
  // forms above; a bare `async` prefix on a non-function is impossible, so nothing to undo here.
  void isAsync;
  return null;
}

/** Is `name` assigned again (`name = …`, `name++`, `name += …`) inside the body? Then it isn't a stable definition. */
function isReassigned(src: string, open: number, close: number, name: string): boolean {
  let i: number = open + 1;
  let seenDecl: boolean = false;
  while (i < close) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    if (ID_START.test(src[i]) && isTokenStart(src, i)) {
      const id: string = readIdent(src, i);
      if (id === name) {
        const prevWord: boolean = isDeclKeywordBefore(src, i);
        const after: number = skipWs(src, i + id.length);
        const c: string = src[after];
        const d: string = src[after + 1];
        const assigns: boolean =
          (c === '=' && d !== '=' && d !== '>') || (c === '+' && d === '+') || (c === '-' && d === '-') ||
          ((c === '+' || c === '-' || c === '*' || c === '/') && d === '=');
        if (assigns) {
          // The declaration itself (`const inc = …`) is the first assignment — allow exactly that one.
          if (prevWord && !seenDecl) seenDecl = true;
          else return true;
        }
      }
      i += id.length;
      continue;
    }
    i++;
  }
  return false;
}

/** Is the token immediately before `i` a `const`/`let`/`var` keyword? */
function isDeclKeywordBefore(src: string, i: number): boolean {
  let k: number = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  let end: number = k + 1;
  while (k >= 0 && ID_CHAR.test(src[k])) k--;
  const word: string = src.slice(k + 1, end);
  return word === 'const' || word === 'let' || word === 'var';
}
