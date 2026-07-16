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
 * A non-function `setup` binding the client can RE-DERIVE — rebuild by re-running its initializer over the
 * resumed ctx (E1.6 computeds, E1.11 anything else built from module scope).
 *
 * Two kinds of value never survive the snapshot: a `computed` (a bare getter — the codec can't claim it, yet
 * the template CALLS it, so a resumed `undefined` throws and kills the page), and a value that simply cannot
 * be serialized (a `router`, a store with methods). Both are reconstructible when their initializer only
 * references things the client already has: module imports, globals, and ctx bindings that DID survive. The
 * emitted `derive(ctx)` re-runs the initializer — guarded by `if (ctx.x === undefined)`, so a binding that
 * DID cross the wire (a signal carrying the server's value) is never clobbered by a fresh one.
 */
export interface SetupDerived {
  /** The full initializer source, emitted verbatim after a ctx rewrite (its callee is a module import). */
  source: string;
}

/** Every extractable top-level `setup` binding, split by shape. */
export interface SetupBindings {
  /** `const inc = () => …` — event handlers (E1.5). */
  handlers: Map<string, SetupHandler>;
  /** Non-function bindings, re-derived on resume (E1.6/E1.11). Insertion order = source order, which is also
   *  dependency order — an initializer can only read a binding declared before it. */
  computeds: Map<string, SetupDerived>;
}

/** The callee of a re-derivable binding — excluded from the free-identifier check (the emit imports it). */
export const COMPUTED_CALLEE: string = 'computed';

/**
 * Names that resolve at MODULE scope — imports plus the module's own top-level declarations.
 *
 * A `derive` emitted into that module can reference any of them, so a binding built from them — `const router =
 * createRouter([route('/', { component: Home })])`, or a computed reading a module-level `const DEFAULTS` — is
 * reconstructible client-side even when the value itself could never cross the wire. Import forms
 * (default/named/aliased/namespace) and top-level `const`/`let`/`var`/`function`/`class` are collected;
 * `import 'x'` (side-effect only) contributes nothing. A `setup`-local shadowing one of these is handled by the
 * caller (it passes its own resolvable set first) — over-collecting here would only ever ACCEPT a binding, and
 * the dogfood showed the real risk is the opposite: rejecting good code because a module const looked unknown.
 */
export function extractModuleImports(script: string): Set<string> {
  const out: Set<string> = new Set();
  // Top-level declarations — DEPTH-AWARE, not a `^const` regex: a `setup` body's own `const` can sit at
  // column 0 (nothing forces indentation), and counting it as module scope would wrongly accept a handler
  // that calls a setup-local helper. Only depth 0 is the module.
  const KW: string[] = ['const', 'let', 'var', 'function', 'class'];
  let i: number = 0;
  let depth: number = 0;
  while (i < script.length) {
    const op: number = skipOpaque(script, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = script[i];
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
    if (depth === 0 && ID_START.test(c) && isTokenStart(script, i)) {
      for (const kw of KW) {
        if (!startsWithWord(script, i, kw)) continue;
        let k: number = skipWs(script, i + kw.length);
        if (script[k] === '*') k = skipWs(script, k + 1); // function*
        const name: string = readIdent(script, k);
        if (name) out.add(name);
        break;
      }
      i = skipWord(script, i);
      continue;
    }
    i++;
  }
  const re: RegExp = /import\s+([^;'"]*?)\s*from\s*['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    const clause: string = m[1];
    // `Default, { a, b as c }` / `* as ns` / `{ x }`
    const braces: RegExpMatchArray | null = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const raw of braces[1].split(',')) {
        const part: string = raw.trim();
        if (!part) continue;
        const alias: string = part.includes(' as ') ? part.split(/\s+as\s+/)[1] : part;
        const name: string = alias.trim().replace(/^type\s+/, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
      }
    }
    const head: string = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const ns: RegExpMatchArray | null = head.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) out.add(ns[1]);
    else if (/^[A-Za-z_$][\w$]*$/.test(head)) out.add(head); // default import
  }
  return out;
}

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
  const computeds: Map<string, SetupDerived> = new Map();
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
          const d: SetupDerived | null = asDerivedInit(parsed.init);
          if (d) computeds.set(parsed.name, d);
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

/**
 * Can this binding be rebuilt over the resumed ctx? Every free identifier of its initializer must be
 * something the client has: a surviving ctx binding, an earlier-derived one, a MODULE IMPORT (the emitted
 * `derive` lives in that same module, so `createRouter`/`computed`/`Home` all resolve), or a JS global.
 * The caller therefore passes `resolvable` already unioned with {@link extractModuleImports}.
 */
export function isDerivable(
  derived: SetupDerived,
  resolvable: ReadonlySet<string>,
  name?: string,
): boolean {
  return unresolvedRefs(derived.source, resolvable, [], name).length === 0;
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

/**
 * A `setup` initializer we can rebuild client-side, or null.
 *
 * Deliberately NARROW — only two shapes, because everything else is a guess:
 *  - a CALL: `computed(…)` · `createRouter([…])` · `signal<T>(null)`. TYPE ARGUMENTS ARE DROPPED: they are
 *    erased at runtime anyway, and keeping them would (a) feed type NAMES to the free-identifier check, which
 *    reads them as values and rejects the binding (`computed<Element|null>(…)` "reads `Element`"), and
 *    (b) leave `<`/`,` in the emit for a scanner that cannot tell a generic from a comparison.
 *  - a simple LITERAL: `2`, `'x'`, `true` — deterministic, so rebuilding is exact.
 *
 * Anything else (`new Cart()`, `a.b()`, a ternary, an object literal) is NOT derived: the instance then just
 * falls back to CSR if its value can't serialize (E1.9), which is honest rather than a wrong rebuild.
 * Both bugs above were found by the docs dogfood — every real component is typed, and no unit test was.
 */
function asDerivedInit(init: string): SetupDerived | null {
  const src: string = init.trim();
  if (!src) return null;
  if (/^(-?\d+(\.\d+)?|true|false|null|'[^'\\]*'|"[^"\\]*")$/.test(src)) return { source: src };
  if (!ID_START.test(src[0])) return null;
  let i: number = 1;
  while (i < src.length && ID_CHAR.test(src[i])) i++;
  const callee: string = src.slice(0, i);
  let j: number = skipWs(src, i);
  if (src[j] === '<') {
    const gt: number = skipTypeArgs(src, j);
    if (gt < 0) return null;
    j = skipWs(src, gt);
  }
  if (src[j] !== '(') return null;
  const rp: number = matchDelimited(src, j, '(', ')');
  if (rp !== src.length - 1) return null; // the whole initializer must BE the call (not `f(…).x`)
  return { source: `${callee}(${src.slice(j + 1, rp)})` };
}

/** Past a `<…>` type-argument list starting at `i`; -1 if unbalanced. `=>` is one token, not a closing `>`. */
function skipTypeArgs(src: string, i: number): number {
  let depth: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '=' && src[i + 1] === '>') {
      i += 2; // a function type inside the args (`signal<() => void>`)
      continue;
    }
    if (c === '<') depth++;
    else if (c === '>') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === '(' || c === '[' || c === '{') {
      const close: number = matchDelimited(src, i, c, c === '(' ? ')' : c === '[' ? ']' : '}');
      if (close < 0) return -1;
      i = close + 1;
      continue;
    } else if (c === ';') return -1;
    i++;
  }
  return -1;
}

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
