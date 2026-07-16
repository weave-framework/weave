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
      i = skipTypeParams(src, i);
      if (src[i] !== '(') return null;
      const rp: number = matchDelimited(src, i, '(', ')');
      if (rp < 0) return null;
      const arrow: number = findArrowAfterType(src, rp + 1);
      if (arrow < 0) return null;
      const b: number = skipWs(src, arrow + 2);
      return src[b] === '{' ? b : null;
    }
  }
  i = skipTypeParams(src, i);
  if (src[i] !== '(') return null;
  const rp: number = matchDelimited(src, i, '(', ')');
  if (rp < 0) return null;
  return bodyAfterReturnType(src, rp + 1);
}

/**
 * Past a generic's TYPE PARAMETERS — `setup<T = { value: string; label: string }>(props)`, the real
 * <Autocomplete> / <Select> / <Menu>. The locator expected `(` right after the name, so the braces inside a
 * default swallowed the body and NOTHING was extracted from those components: every handler in them was dead.
 * Unchanged when there are none, so a plain `setup(` costs nothing.
 */
function skipTypeParams(src: string, i: number): number {
  if (src[i] !== '<') return i;
  const gt: number = skipTypeArgs(src, i);
  return gt < 0 ? i : skipWs(src, gt);
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

  // A FUNCTION reassigned anywhere in the body is not a stable definition — inlining it would use a stale body,
  // so drop it. E1.30: a VALUE is different. It has no body, only an initial value, and it is a setup local that
  // never crossed the wire — so rebuilding it from its initializer is exactly what derive does for every other
  // local (`let dragging = false`, a transient flag <Slider> keeps in setup's closure; nobody is mid-drag at
  // resume). A reassigned value that setup RETURNS is unaffected either way: it crosses the wire with its final
  // value and derive's `undefined` guard leaves it alone.
  for (const name of [...out.keys()]) {
    if (isReassigned(script, open, close, name)) out.delete(name);
  }

  // E1.34 — handlers defined INLINE in setup's `return { … }`, the shape most of the docs demos and much of
  // @weave-framework/ui use (`return { count, inc: () => count.set(n => n + 1) }`). Only declarations were read,
  // so every one of these reported "its definition could not be read from setup()" and fell back to a dead
  // `ctx.inc`. An object property cannot be reassigned, so the filter above does not apply to them. Functions
  // ONLY: a value returned inline already crosses the wire, so there is nothing to rebuild.
  for (const [name, value] of returnEntries(script)) {
    if (out.has(name) || computeds.has(name)) continue; // a real declaration wins
    const h: SetupHandler | null = asFunctionExpr(value);
    if (h) out.set(name, h);
  }
  return empty;
}

/**
 * `name: <value>` entries of setup's `return { … }` object. A shorthand (`count,`) is a REFERENCE, not a
 * definition, so it is skipped — as is a spread or a computed key, which name nothing statically.
 */
function returnEntries(script: string): Map<string, string> {
  const out: Map<string, string> = new Map();
  const open: number | null = locateSetupBody(script);
  if (open === null) return out;
  const close: number = matchDelimited(script, open, '{', '}');
  if (close < 0) return out;

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
      if (script[b] !== '{') return out; // `return x` / `return;` — not a plain object literal
      const rb: number = matchDelimited(script, b, '{', '}');
      if (rb < 0) return out;
      for (const part of splitTop(script.slice(b + 1, rb))) {
        const p: string = part.trim();
        const name: string = readIdent(p, 0);
        if (!name) continue; // a spread, a computed key, or a quoted one
        const k: number = skipWs(p, name.length);
        if (p[k] !== ':') continue; // a shorthand — a reference to a binding read elsewhere
        out.set(name, p.slice(k + 1).trim());
      }
      return out;
    }
    i = ID_START.test(c) && isTokenStart(script, i) ? skipWord(script, i) : i + 1;
  }
  return out;
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
  // E1.18 — `freeIdentifiers` is the TEMPLATE basis, and a template has no type annotations (its `:` is a
  // ternary). Setup code has both, so analysing it raw reported TYPE names as ctx refs and the body's own
  // locals as unresolved: the real `<Checkbox>` warned that its handler "reads `el`, `HTMLInputElement`,
  // `next`, `boolean`, `props`" when only `props` was true. Strip the annotations, then treat the body's own
  // declarations as what they are — locals. Analysis only; the EMIT still inlines the source verbatim (it is
  // TS inside a TS module, so esbuild erases the types).
  const src: string = stripDeclTypes(source);
  const locals: Set<string> = declaredLocals(src);
  const out: string[] = [];
  for (const id of freeIdentifiers(src)) {
    if (id === name || id === ignore) continue; // self-reference, or the emitted callee (`computed`)
    if (params.includes(id) || locals.has(id)) continue; // its own parameter / its own local
    if (!ctxNames.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Blank out TS type annotations in the two positions where a `:` cannot be anything else — after a
 * `const`/`let`/`var` name, and after a parameter list. Everywhere else a `:` is ambiguous (a ternary, an
 * object key), so it is left alone: this is a narrowing pass for the analysis, not a TS stripper.
 */
function stripDeclTypes(src: string): string {
  let out: string = '';
  let i: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      // A COMMENT contributes no identifiers — `freeIdentifiers` skips strings and template literals but not
      // comments, so every prose word was read as a ctx ref (a real <Radio> handler blamed `Sync`, `the`,
      // `navigates`, …). Blank it; keep strings/template literals, whose `${…}` IS code.
      out += /^\/[/*]/.test(src.slice(i, i + 2)) ? ' ' : src.slice(i, op);
      i = op;
      continue;
    }
    // `x as T` — a type assertion. Only after a value (an identifier or a closing bracket), so a variable
    // named `as` or an `import * as ns` is untouched.
    if (startsWithWord(src, i, 'as') && isTokenStart(src, i) && /[\w$)\]]/.test(lastNonWs(out))) {
      out += ' ';
      i = skipTypeRef(src, skipWs(src, i + 2));
      continue;
    }
    // `const x: T = …` / `let x: T` — after a declared name, a `:` is always the annotation.
    const kw: string | null = startsWithWord(src, i, 'const') ? 'const' : startsWithWord(src, i, 'let') ? 'let' : startsWithWord(src, i, 'var') ? 'var' : null;
    if (kw && isTokenStart(src, i)) {
      let j: number = skipWs(src, i + kw.length);
      const s: number = j;
      while (j < n && ID_CHAR.test(src[j])) j++;
      if (j > s) {
        const k: number = skipWs(src, j);
        if (src[k] === ':') {
          out += src.slice(i, j) + ' ';
          i = endOfAnnotation(src, k + 1, ['=', ';', ',', ')']);
          continue;
        }
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    // A call's TYPE ARGUMENTS — `signal<Element | null>(null)`. `Element` is a type, erased at runtime, but the
    // scanner would read it as a value: this is why the old asDerivedInit dropped type args, and why widening it
    // (E1.28) brought every element-ref drop straight back. Only when `<` follows an identifier immediately and
    // its match is followed by `(`, so a comparison (`a < b`) is untouched.
    if (src[i] === '<' && i > 0 && ID_CHAR.test(src[i - 1])) {
      const gt: number = skipTypeArgs(src, i);
      if (gt > i && src[skipWs(src, gt)] === '(') {
        out += ' ';
        i = gt;
        continue;
      }
    }
    // An arrow's PARAMETER list — `(e: KeyboardEvent, n: number = 2) =>`. Only strip when the `)` is followed
    // by `=>` (optionally through a return type), so a plain CALL's parens are never touched.
    if (src[i] === '(') {
      const close: number = matchDelimited(src, i, '(', ')');
      if (close > i && isArrowParams(src, close)) {
        out += `(${stripParamTypes(src.slice(i + 1, close))}) `;
        i = close + 1;
        // …and its RETURN type, here: consuming the `)` above is what stopped the `)`-then-`:` branch below from
        // ever seeing it, so `(): DOMRect | null => {…}` was blamed for reading `DOMRect`.
        const k: number = skipWs(src, i);
        if (src[k] === ':') i = endOfAnnotation(src, k + 1, ['=>', '{', ';']);
        continue;
      }
    }
    // `(…): T =>` / `(…): T {` — after a parameter list, a `:` is always the return type.
    if (src[i] === ')') {
      const k: number = skipWs(src, i + 1);
      if (src[k] === ':') {
        out += ') ';
        i = endOfAnnotation(src, k + 1, ['=>', '{', ';']);
        continue;
      }
    }
    out += src[i];
    i++;
  }
  return out;
}

/** The last non-whitespace char of `s` ('' if none) — used to tell `x as T` from a bare `as`. */
function lastNonWs(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) if (!/\s/.test(s[i])) return s[i];
  return '';
}

/**
 * Past a TYPE REFERENCE at `i` — `Foo`, `a.b.C`, `Foo<Bar>`, `Foo[]`, `A | B`. Stops at the first thing a type
 * cannot contain, so real code after the assertion (`(x as T).y`, `x as T; f()`) is left for the scanner.
 */
function skipTypeRef(src: string, i: number): number {
  const n: number = src.length;
  for (;;) {
    while (i < n && (ID_CHAR.test(src[i]) || src[i] === '.')) i++;
    let k: number = i;
    if (src[k] === '<') {
      const close: number = skipTypeArgs(src, k);
      if (close < 0) return i;
      k = close;
    }
    while (src[k] === '[' && src[skipWs(src, k + 1)] === ']') k = skipWs(src, k + 1) + 1;
    i = k;
    const j: number = skipWs(src, i);
    if ((src[j] === '|' || src[j] === '&') && src[j + 1] !== '|' && src[j + 1] !== '&') {
      i = skipWs(src, j + 1); // a union / intersection continues the type
      continue;
    }
    return i;
  }
}

/** Is the `)` at `close` the end of an ARROW's parameter list (possibly through a `: ReturnType`)? */
function isArrowParams(src: string, close: number): boolean {
  let k: number = skipWs(src, close + 1);
  if (src[k] === ':') k = skipWs(src, endOfAnnotation(src, k + 1, ['=>', '{', ';']));
  return src.startsWith('=>', k);
}

/**
 * Strip each parameter's `: Type` from an arrow's parameter list. A `:` counts only BEFORE that parameter's
 * `=`, so a DEFAULT VALUE — real code, possibly reading ctx — survives intact, including a ternary default
 * (`n = pick ? 1 : 2`), whose `:` must not be mistaken for an annotation.
 */
function stripParamTypes(params: string): string {
  const out: string[] = [];
  for (const part of splitTop(params)) {
    let depth: number = 0;
    let cut: number = -1;
    for (let i = 0; i < part.length; i++) {
      const op: number = skipOpaque(part, i);
      if (op > i) {
        i = op - 1;
        continue;
      }
      const c: string = part[i];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
      else if (depth === 0 && c === '=' && part[i + 1] !== '>' && part[i - 1] !== '=' && part[i - 1] !== '!') break; // a default → keep the rest
      else if (depth === 0 && c === ':') {
        cut = i;
        break;
      }
    }
    if (cut < 0) {
      out.push(part);
      continue;
    }
    const eq: number = endOfAnnotation(part, cut + 1, ['=']);
    out.push(part.slice(0, cut) + ' ' + part.slice(eq));
  }
  return out.join(',');
}

/**
 * Split on top-level commas — a parameter list, or setup's `return { … }` entries.
 *
 * `<`/`>` are NOT counted as a pair: `>` also ends an ARROW, so counting it sent the depth negative and every
 * later comma stopped looking top-level — a return object came back as one giant entry. Type arguments are
 * skipped wholesale instead (only where `<` follows an identifier), which keeps a comma inside `Map<K, V>` from
 * splitting while leaving a comparison alone.
 */
function splitTop(src: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let start: number = 0;
  let i: number = 0;
  while (i < src.length) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '=' && src[i + 1] === '>') {
      i += 2; // an arrow, not a closing bracket
      continue;
    }
    if (c === '<' && i > 0 && ID_CHAR.test(src[i - 1])) {
      const gt: number = skipTypeArgs(src, i);
      if (gt > i) {
        i = gt;
        continue;
      }
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(src.slice(start));
  return out;
}

/** Scan past an annotation body to the first of `stops` at depth 0 (a type may nest `<>`/`()`/`{}`/`[]`). */
function endOfAnnotation(src: string, i: number, stops: readonly string[]): number {
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    for (const s of stops) if (src.startsWith(s, i)) return i;
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') {
      const close: number = c === '<' ? skipTypeArgs(src, i) : matchDelimited(src, i, c, c === '(' ? ')' : c === '[' ? ']' : '}') + 1;
      if (close <= i) return i; // unbalanced → stop here rather than run away
      i = close;
      continue;
    }
    i++;
  }
  return n;
}

/** Every name this code declares itself (`const`/`let`/`var`, at any depth) — locals, not unresolved refs. */
function declaredLocals(src: string): Set<string> {
  const out: Set<string> = new Set<string>();
  let i: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const kw: string | null = startsWithWord(src, i, 'const') ? 'const' : startsWithWord(src, i, 'let') ? 'let' : startsWithWord(src, i, 'var') ? 'var' : null;
    if (kw && isTokenStart(src, i)) {
      let j: number = skipWs(src, i + kw.length);
      const s: number = j;
      while (j < n && ID_CHAR.test(src[j])) j++;
      if (j > s) out.add(src.slice(s, j)); // a destructuring pattern declares no bare name here → skipped
      i = j;
      continue;
    }
    i++;
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
  // E1.28 — ANY bounded initializer. This was once narrowed to "a call or a literal" as a reaction to a LEXICAL
  // bug (a type-arg scan that emitted `ctx.input = signal<;` and failed the build), not to the expression shape
  // — and the narrowing cost far more than it bought: the real <Sidenav>'s
  // `const bp = props.breakpoint ?? Breakpoints.Narrow` is neither, so the whole chain behind it
  // (`narrow` → `effectiveMode` → `opened` → `setOpened` → every handler) died at the first link. E1.18's
  // annotation handling covers the lexical hazard properly now, and `declEnd` (E1.19) bounds the initializer.
  //
  // Rebuilding is never a wrong ANSWER, only possibly a stale one: `derive`'s `if (ctx.x === undefined)` guard
  // means it runs only for a value that could NOT cross the wire, where the alternative is dropping the whole
  // instance to CSR. A `new Cart()` is no different in kind from the `createRouter([…])` this always accepted.
  //
  // The source is emitted VERBATIM, types and all — it lands in a TS module, so esbuild erases them.
  if (!balanced(src)) return null; // the scanner is not confident → fall back rather than emit something broken
  return { source: src };
}

/** Are all bracket pairs closed and no stray closer present? A cheap "the scan bounded this correctly" check. */
function balanced(src: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let i: number = 0;
  while (i < src.length) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== pairs[c]) return false;
    }
    i++;
  }
  return stack.length === 0;
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

/**
 * Split a `( … )` parameter list into simple names (a destructured/defaulted param yields its head token).
 * `?` ends a name too: an OPTIONAL param (`e?: Event`) otherwise yielded `e?`, which failed the identifier
 * test and was dropped — so the handler got blamed for reading its own argument (`save`, `submit` on the docs).
 */
function paramNames(list: string): string[] {
  const out: string[] = [];
  for (const raw of splitTopLevel(list)) {
    const name: string = raw.trim().split(/[\s=:?]/)[0].replace(/[{}[\]().]/g, '');
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
  // E1.35 — skip a RETURN TYPE. `function openPanel(): void { … }` (<Autocomplete>, <DateRangePicker>, <Menu>)
  // used to bail here, so the helper vanished and every handler calling it was refused. Skipping an annotation
  // is the same thing E1.5-3 already had to do for `setup` itself.
  let bodyOpen: number = skipWs(src, rp + 1);
  if (src[bodyOpen] === ':') bodyOpen = skipWs(src, endOfAnnotation(src, bodyOpen + 1, ['{', ';']));
  if (src[bodyOpen] !== '{') return null; // still not a body → fail-safe skip
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
  // A type annotation (`const inc: () => void = …`) — skip to the ASSIGNMENT. E1.29: not simply the first
  // top-level `=`, because a FUNCTION-TYPE annotation contains one — `const narrow: () => boolean = f(bp)` bailed
  // on the arrow's `=` and the binding vanished from the extraction, taking everything behind it with it.
  if (src[k] === ':') {
    const eq: number = assignAfterType(src, k + 1);
    // E1.32 — no `=` at all: an ANNOTATED declaration with no initializer (`let timer: Timeout | undefined;`).
    // It is not "unreadable" — its value IS undefined, which is exactly what setup's closure started with, so
    // rebuild it as that. Without this it was not extracted, and every handler assigning it was refused.
    if (eq < 0) {
      const semi: number = findTopLevel(src, k, ';');
      return semi < 0 ? null : { name, init: 'undefined', end: semi };
    }
    k = eq;
  }
  if (src[k] === ';') return { name, init: 'undefined', end: k }; // a bare `let x;`
  if (src[k] !== '=' || src[k + 1] === '=' || src[k + 1] === '>') return null;
  const start: number = skipWs(src, k + 1);
  const end: number = declEnd(src, start);
  if (end < 0) return null;
  return { name, init: src.slice(start, end).trim(), end };
}

/**
 * Offset of a declaration's ASSIGNMENT `=` at or after `i`, scanning past a type annotation. `=>` (a function
 * type) and `==`/`>=`/`<=`/`!=` are not it; a `;` or an unbalanced closer means there is none.
 */
function assignAfterType(src: string, i: number): number {
  let depth: number = 0;
  while (i < src.length) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0 && c === '=') {
      if (src[i + 1] === '>' || src[i + 1] === '=') {
        i += 2; // `=>` inside a function type, or `==` — neither is the assignment
        continue;
      }
      return i;
    } else if (depth === 0 && c === ';') return -1;
    i++;
  }
  return -1;
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
      // ASI: a newline ends the initializer only when the expression is COMPLETE. It is not if the last real
      // token is a dangling operator — `const f = (o: T): boolean =>\n  a ? b : c;` is how a long arrow wraps,
      // and cutting at the newline yielded a source ending in `=>`, which the emit turned into
      // `const f = (o: T): boolean =>;` — a BUILD failure, invisible until E1.19 started emitting helpers.
      if (danglingOperator(src, i)) {
        i++;
        continue;
      }
      // E1.37 — a LEADING operator continues the line too, exactly as a trailing one does. `:` was missing, so
      // the real <Table>'s wrapped ternary (`isDataSource(p)\n ? p.connect()\n : signal(…)`) was cut after the
      // `?` branch and emitted `? props.dataSource.connect();` — a BUILD failure. This matches real ASI: none of
      // these can begin a statement.
      const next: number = skipWs(src, i);
      const nc: string = src[next] ?? '';
      if (!/[.?):\],&|+\-*/%^<>=]/.test(nc)) return i;
    }
    i++;
  }
  return src.length;
}

/** Does the code before the newline at `i` end mid-expression (a trailing operator)? `a++` / `a--` do not. */
function danglingOperator(src: string, i: number): boolean {
  let k: number = i - 1;
  while (k >= 0 && /[ \t\r]/.test(src[k])) k--;
  if (k < 0) return false;
  const c: string = src[k];
  if ((c === '+' || c === '-') && src[k - 1] === c) return false; // `a++` / `a--` — the expression is complete
  return /[+\-*/%&|^?:=<>,([{.!~]/.test(c);
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
