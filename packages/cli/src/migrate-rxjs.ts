/**
 * RxJS → Weave, TRANSLATED rather than annotated.
 *
 * Weave is signal-native and has no stream primitive, so an app that finishes a migration still importing `rxjs`
 * has not been migrated — it has been moved. This module removes the streams instead of describing them.
 *
 * The translation is a fold over a SHAPE machine. An RxJS chain in application code is almost never an infinite
 * stream; it is one of three things, and each has an exact JavaScript equivalent:
 *
 *   - `value`   — one synchronous emission (`of(x)`), so the chain is plain expression application.
 *   - `array`   — a finite sequence of emissions (`of(a, b)`, `concat(…)`, `EMPTY`), so the operators are the
 *                 array methods they were modelled on: `map`/`filter`/`flatMap`/`slice`/`reduce`.
 *   - `promise` — one asynchronous emission (`from(p)`, `forkJoin([…])`), so the chain is `.then(…)`/`await`.
 *
 * Each source is classified, then each operator folds the shape forward. An operator with no equivalent AT THAT
 * SHAPE stops the fold, and the original expression is left standing with a TODO naming the operator — a chain
 * that is 80% translatable is not rewritten 80% of the way, because a half-rewritten chain compiles and lies.
 * Nothing here guesses: every mapping below is the one the operator was defined in terms of.
 */

/* ──────────── scanning (the same rule as everywhere else: scan, never regex across a literal) ──────────── */

/** The index of the bracket closing the one at `open`, or -1. Skips string and template literals. */
export function matchClose(code: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close: string | undefined = pairs[code[open]];
  if (!close) return -1;
  let depth: number = 0;
  let quote: string = '';
  for (let i: number = open; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === code[open]) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** Split a call's argument text on its TOP-LEVEL commas, so `map((a, b) => a)` stays one argument. */
export function splitTop(inner: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let quote: string = '';
  let start: number = 0;
  for (let i: number = 0; i < inner.length; i++) {
    const ch: string = inner[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail: string = inner.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * The start index of the expression that ENDS at `end` (exclusive) — the receiver of a `.pipe(`/`.subscribe(`.
 *
 * Walked backwards over balanced brackets and identifier/property runs, because the receiver is an arbitrary
 * expression: `concat(of(a), of(b))`, `this.http.get<T>(url)`, `xs[0].source`.
 */
export function receiverStart(code: string, end: number): number {
  let i: number = end - 1;
  const isIdent = (c: string): boolean => /[\w$]/.test(c);
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (i < 0) break;
    const ch: string = code[i];
    if (ch === ')' || ch === ']') {
      const open: number = openingOf(code, i);
      if (open < 0) break;
      i = open - 1;
      continue;
    }
    if (ch === '>' ) {
      // A generic argument list on the call we just walked over: `get<Crumb[]>(url)`.
      const open: number = angleOpen(code, i);
      if (open < 0) break;
      i = open - 1;
      continue;
    }
    if (isIdent(ch)) {
      while (i >= 0 && isIdent(code[i])) i--;
      // An identifier only continues leftwards THROUGH a dot. Without this check the walk ran straight past the
      // space in `return concat(…)` and swallowed the keyword, and the source it handed the fold — `return
      // concat(…)` — classified as nothing, so every chain in a `return` statement was left untranslated.
      let j: number = i;
      while (j >= 0 && /\s/.test(code[j])) j--;
      if (j >= 0 && code[j] === '.') {
        i = j;
        continue;
      }
      return i + 1;
    }
    if (ch === '.') {
      i--;
      continue;
    }
    break;
  }
  return i + 1;
}

/** The index of the bracket opening the one at `close`, or -1. */
function openingOf(code: string, close: number): number {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const open: string | undefined = pairs[code[close]];
  if (!open) return -1;
  let depth: number = 0;
  for (let i: number = close; i >= 0; i--) {
    if (code[i] === code[close]) depth++;
    else if (code[i] === open && --depth === 0) return i;
  }
  return -1;
}

/** The `<` matching a generic list's closing `>`, or -1 when the `>` was an operator rather than a bracket. */
function angleOpen(code: string, close: number): number {
  let depth: number = 0;
  for (let i: number = close; i >= 0; i--) {
    const ch: string = code[i];
    if (ch === '>') depth++;
    else if (ch === '<' && --depth === 0) return i;
    else if (ch === ';' || ch === '{' || ch === '}' || ch === '\n') return -1;
  }
  return -1;
}

/** Wrap in parentheses only when a trailing `.method()` would otherwise bind to the wrong thing. */
function wrap(code: string): string {
  const t: string = code.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return t;
  if (/^\[[\s\S]*\]$/.test(t) && matchClose(t, 0) === t.length - 1) return t;
  if (/^\([\s\S]*\)$/.test(t) && matchClose(t, 0) === t.length - 1) return t;
  // A property/call chain with nothing loose at the top level needs no parentheses.
  let depth: number = 0;
  let quote: string = '';
  let loose: boolean = false;
  for (let i: number = 0; i < t.length; i++) {
    const ch: string = t[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && /[\s?:+\-*/|&,=]/.test(ch)) loose = true;
  }
  return loose ? `(${t})` : t;
}

/* ──────────── the shape machine ──────────── */

/** What the chain holds at this point. `unknown` means the fold cannot continue without guessing. */
export type RxShape = 'value' | 'array' | 'promise' | 'unknown';

/** A point in the fold: the JavaScript built so far, and what that JavaScript evaluates to. */
export interface Folded {
  code: string;
  shape: RxShape;
}

/**
 * Classify an RxJS SOURCE expression into plain JavaScript plus its shape.
 *
 * `of(a)` is one emission and `of(a, b)` is two, so they land on different shapes — that distinction is the whole
 * reason `concat(of(ids), of([]))` becomes `[ids, []]` rather than `[...ids]`, and getting it wrong silently
 * flattens a level.
 */
export function classifySource(expr: string, todos: string[]): Folded {
  const t: string = expr.trim();
  if (t === 'EMPTY') return { code: '[]', shape: 'array' };

  const call: RegExpMatchArray | null = t.match(/^([A-Za-z_$][\w$]*)\s*(?:<[\s\S]*?>)?\s*\(/);
  if (!call) return { code: t, shape: 'unknown' };
  const name: string = call[1];
  const open: number = t.indexOf('(', call[0].length - 1);
  const close: number = matchClose(t, open);
  if (close !== t.length - 1) return { code: t, shape: 'unknown' }; // not a single call — leave it alone
  const args: string[] = splitTop(t.slice(open + 1, close));

  switch (name) {
    case 'of':
      if (args.length === 0) return { code: 'undefined', shape: 'value' };
      if (args.length === 1) return { code: args[0], shape: 'value' };
      return { code: `[${args.join(', ')}]`, shape: 'array' };
    case 'from': {
      // `from` accepts an iterable OR a promise. An array literal is unambiguous; anything else is overwhelmingly
      // a promise in Angular code, and the TODO says so rather than the rewrite pretending it was certain.
      if (/^\[[\s\S]*\]$/.test(args[0] ?? '')) return { code: args[0], shape: 'array' };
      todos.push('`from(…)` was read as wrapping a PROMISE — if its argument was an iterable, drop the `Promise.resolve` and treat it as the array it already is');
      return { code: `Promise.resolve(${args[0] ?? ''})`, shape: 'promise' };
    }
    case 'concat':
    case 'merge': {
      // Sequencing streams is concatenating their emissions. Each argument contributes its own emissions, so a
      // single-value source contributes `[v]` and a multi-value one spreads.
      const parts: string[] = [];
      for (const a of args) {
        const inner: Folded = classifySource(a, todos);
        if (inner.shape === 'value') parts.push(inner.code);
        else if (inner.shape === 'array') parts.push(`...${wrap(inner.code)}`);
        else return { code: t, shape: 'unknown' };
      }
      return { code: `[${parts.join(', ')}]`, shape: 'array' };
    }
    case 'forkJoin':
      if (args.length === 1 && /^\[[\s\S]*\]$/.test(args[0])) return { code: `Promise.all(${args[0]})`, shape: 'promise' };
      return { code: t, shape: 'unknown' };
    case 'range': {
      const [start, count] = args;
      return { code: `Array.from({ length: ${count ?? start} }, (_, __i) => ${count ? `${start} + __i` : '__i'})`, shape: 'array' };
    }
    default:
      return { code: t, shape: 'unknown' };
  }
}

/** One operator's fold. Returns null when it has no equivalent at this shape — which STOPS the rewrite. */
type OpFn = (cur: Folded, args: string[], todos: string[]) => Folded | null;

const ident = (c: Folded): Folded => c;

/**
 * The operator table. Every entry is the definition of the operator restated over the shape it is folding —
 * `map` over a finite sequence IS `Array.prototype.map`, `mergeMap` IS `flatMap`, `shareReplay` over a value that
 * is already computed IS nothing at all. Where an operator is genuinely about TIME (`debounceTime`, `delay`,
 * `scan` over a live source) there is no equivalent expression, so it is absent and the fold stops.
 */
const OPS: Record<string, OpFn> = {
  map: (c, [f]) =>
    c.shape === 'array' ? { code: `${wrap(c.code)}.map(${f})`, shape: 'array' }
    : c.shape === 'promise' ? { code: `${wrap(c.code)}.then(${f})`, shape: 'promise' }
    : c.shape === 'value' ? { code: `${wrap(f)}(${c.code})`, shape: 'value' }
    : null,
  mapTo: (c, [v]) =>
    c.shape === 'array' ? { code: `${wrap(c.code)}.map(() => ${v})`, shape: 'array' }
    : c.shape === 'promise' ? { code: `${wrap(c.code)}.then(() => ${v})`, shape: 'promise' }
    : c.shape === 'value' ? { code: v, shape: 'value' }
    : null,
  pluck: (c, keys) => {
    const path: string = keys.map((k) => `[${k}]`).join('');
    return c.shape === 'array' ? { code: `${wrap(c.code)}.map((__v) => __v${path})`, shape: 'array' }
      : c.shape === 'value' ? { code: `${wrap(c.code)}${path}`, shape: 'value' }
      : null;
  },
  filter: (c, [p]) =>
    c.shape === 'array' ? { code: `${wrap(c.code)}.filter(${p})`, shape: 'array' }
    : c.shape === 'value' ? { code: `${wrap(p)}(${c.code}) ? ${wrap(c.code)} : undefined`, shape: 'value' }
    : null,
  // The three flattening strategies differ only in how they schedule the inner work. Over a finite sequence of
  // already-resolved values there is no scheduling left to differ about, so all three are `flatMap` — but
  // `switchMap` also CANCELLED the previous inner call, and that part has no equivalent, so it is said out loud.
  mergeMap: (c, [f]) => flatten(c, f),
  concatMap: (c, [f]) => flatten(c, f),
  switchMap: (c, [f], todos) => {
    if (c.shape === 'array') todos.push('`switchMap` cancelled the previous inner call when a new value arrived; the `flatMap` below does not — if the inner call is an async fetch, use a `resource` keyed on the source instead');
    return flatten(c, f);
  },
  mergeAll: (c) => (c.shape === 'array' ? { code: `${wrap(c.code)}.flat()`, shape: 'array' } : null),
  concatAll: (c) => (c.shape === 'array' ? { code: `${wrap(c.code)}.flat()`, shape: 'array' } : null),
  toArray: (c) =>
    c.shape === 'array' ? c : c.shape === 'value' ? { code: `[${c.code}]`, shape: 'array' } : null,
  distinct: (c, [key]) =>
    c.shape !== 'array' ? null
    : key
      ? { code: `[...new Map(${wrap(c.code)}.map((__v) => [${wrap(key)}(__v), __v])).values()]`, shape: 'array' }
      : { code: `[...new Set(${wrap(c.code)})]`, shape: 'array' },
  distinctUntilChanged: (c) =>
    c.shape === 'array' ? { code: `${wrap(c.code)}.filter((__v, __i, __a) => __i === 0 || __v !== __a[__i - 1])`, shape: 'array' }
    : c.shape === 'value' ? c
    : null,
  first: (c, [p]) =>
    c.shape !== 'array' ? (c.shape === 'value' ? c : null)
    : p
      ? { code: `${wrap(c.code)}.find(${p})`, shape: 'value' }
      : { code: `${wrap(c.code)}[0]`, shape: 'value' },
  last: (c) => (c.shape === 'array' ? { code: `${wrap(c.code)}.at(-1)`, shape: 'value' } : c.shape === 'value' ? c : null),
  take: (c, [n]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.slice(0, ${n})`, shape: 'array' } : null),
  takeLast: (c, [n]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.slice(-${n})`, shape: 'array' } : null),
  skip: (c, [n]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.slice(${n})`, shape: 'array' } : null),
  skipLast: (c, [n]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.slice(0, -${n})`, shape: 'array' } : null),
  startWith: (c, [v]) => (c.shape === 'array' ? { code: `[${v}, ...${wrap(c.code)}]`, shape: 'array' } : c.shape === 'value' ? { code: `[${v}, ${c.code}]`, shape: 'array' } : null),
  elementAt: (c, [n]) => (c.shape === 'array' ? { code: `${wrap(c.code)}[${n}]`, shape: 'value' } : null),
  reduce: (c, [f, seed]) => (c.shape === 'array' && seed !== undefined ? { code: `${wrap(c.code)}.reduce(${f}, ${seed})`, shape: 'value' } : null),
  every: (c, [p]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.every(${p})`, shape: 'value' } : null),
  find: (c, [p]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.find(${p})`, shape: 'value' } : null),
  findIndex: (c, [p]) => (c.shape === 'array' ? { code: `${wrap(c.code)}.findIndex(${p})`, shape: 'value' } : null),
  count: (c) => (c.shape === 'array' ? { code: `${wrap(c.code)}.length`, shape: 'value' } : null),
  isEmpty: (c) => (c.shape === 'array' ? { code: `${wrap(c.code)}.length === 0`, shape: 'value' } : null),
  max: (c) => (c.shape === 'array' ? { code: `Math.max(...${wrap(c.code)})`, shape: 'value' } : null),
  min: (c) => (c.shape === 'array' ? { code: `Math.min(...${wrap(c.code)})`, shape: 'value' } : null),
  defaultIfEmpty: (c, [d]) =>
    c.shape === 'array' ? { code: `(${wrap(c.code)}.length ? ${wrap(c.code)} : [${d}])`, shape: 'array' }
    : c.shape === 'value' ? { code: `${wrap(c.code)} ?? ${d}`, shape: 'value' }
    : null,
  tap: (c, [f]) =>
    c.shape === 'array' ? { code: `${wrap(c.code)}.map((__v) => (${wrap(f)}(__v), __v))`, shape: 'array' }
    : c.shape === 'promise' ? { code: `${wrap(c.code)}.then((__v) => (${wrap(f)}(__v), __v))`, shape: 'promise' }
    : null,
  // Sharing and scheduling exist because an Observable is cold and multicast is opt-in. A value that has already
  // been computed is shared by definition, and Weave schedules its own updates — so these fold to nothing.
  shareReplay: ident,
  share: ident,
  publishReplay: ident,
  refCount: ident,
  observeOn: ident,
  subscribeOn: ident,
  // Teardown is the owner's job in Weave, so the operator that bounded a subscription's life has nothing to do
  // inside an expression — the enclosing `effect`/`store` is disposed with its owner.
  takeUntilDestroyed: ident,
};

/** `mergeMap`/`concatMap`/`switchMap` over a finite sequence is `flatMap`; over a single async value it is `then`. */
function flatten(c: Folded, f: string): Folded | null {
  if (c.shape === 'array') return { code: `${wrap(c.code)}.flatMap(${f})`, shape: 'array' };
  if (c.shape === 'promise') return { code: `${wrap(c.code)}.then(${f})`, shape: 'promise' };
  if (c.shape === 'value') return { code: `${wrap(f)}(${c.code})`, shape: 'unknown' };
  return null;
}

/** The operators this module can fold — used by callers to decide whether a chain is translatable at all. */
export function foldableOperators(): string[] {
  return Object.keys(OPS).sort();
}

/**
 * Fold one `source.pipe(op, op, …)` into plain JavaScript, or null when an operator has no equivalent.
 *
 * Null is a deliberate all-or-nothing: a chain rewritten up to the operator that stopped it would read as
 * finished code that quietly drops the rest of the pipeline.
 */
export function foldPipe(source: string, ops: string[], todos: string[]): Folded | null {
  let cur: Folded = classifySource(source, todos);
  for (const op of ops) {
    const call: RegExpMatchArray | null = op.trim().match(/^([A-Za-z_$][\w$]*)\s*(?:<[\s\S]*?>)?\s*\(/);
    if (!call) return null;
    const name: string = call[1];
    const open: number = op.indexOf('(', call[0].length - 1);
    const close: number = matchClose(op, open);
    if (close < 0) return null;
    const fn: OpFn | undefined = OPS[name];
    if (!fn) {
      todos.push(`\`${name}\` has no expression equivalent in Weave — it is about TIME or control flow, so this chain is left as it was; rewrite it by hand (see migration-plan.md)`);
      return null;
    }
    const next: Folded | null = fn(cur, splitTop(op.slice(open + 1, close)), todos);
    if (!next) {
      todos.push(`\`${name}\` has no equivalent over ${cur.shape === 'unknown' ? 'a source this rewrite could not classify' : `a ${cur.shape}`} — this chain is left as it was; rewrite it by hand`);
      return null;
    }
    cur = next;
  }
  return cur;
}

/* ──────────── the driver ──────────── */

/** What a translation produced: the rewritten code, the TODOs it owes the reader, and whether `await` appeared. */
export interface RxResult {
  code: string;
  todos: string[];
  /** True when the rewrite introduced `await`, so the enclosing function has to become `async`. */
  introducedAwait: boolean;
}

/**
 * Rewrite every RxJS expression in a blob of code.
 *
 * Run to a fixpoint (bounded), because chains nest: the `of(x)` inside a `mergeMap` callback has to collapse
 * before the callback it sits in can be judged translatable.
 */
export function translateRx(code: string): RxResult {
  const todos: string[] = [];
  let out: string = code;
  let awaited: boolean = false;
  for (let pass: number = 0; pass < 6; pass++) {
    const before: string = out;
    out = rewritePipes(out, todos);
    out = rewriteBareSubscribes(out, todos);
    const un: { code: string; awaited: boolean } = rewriteUnwrappers(out, todos);
    out = un.code;
    awaited = awaited || un.awaited;
    out = rewriteBareSources(out, todos);
    if (out === before) break;
  }
  return { code: out, todos: [...new Set(todos)], introducedAwait: awaited };
}

/** Every `X.pipe(…)` — and the `.subscribe(…)` hanging off it — folded into plain JavaScript. */
function rewritePipes(code: string, todos: string[]): string {
  let out: string = code;
  let from: number = 0;
  for (;;) {
    const at: number = indexOfOutsideStrings(out, '.pipe', from);
    if (at < 0) return out;
    const open: number = out.indexOf('(', at + 5);
    if (open < 0 || out.slice(at + 5, open).trim() !== '') {
      from = at + 5;
      continue;
    }
    const close: number = matchClose(out, open);
    if (close < 0) {
      from = at + 5;
      continue;
    }
    const start: number = receiverStart(out, at);
    const folded: Folded | null = foldPipe(out.slice(start, at), splitTop(out.slice(open + 1, close)), todos);
    if (!folded) {
      from = close + 1;
      continue;
    }
    // A `.subscribe(cb)` immediately after the chain is part of the same statement, and the shape decides what it
    // becomes — running the callback once per emission is `forEach`, once for a value is a plain call.
    const tail: { code: string; end: number } | null = takeSubscribe(out, close + 1, folded, todos);
    const replaced: string = tail ? tail.code : folded.code;
    const end: number = tail ? tail.end : close + 1;
    out = out.slice(0, start) + replaced + out.slice(end);
    from = start + replaced.length;
  }
}

/**
 * `source.subscribe(cb)` with no operators between them.
 *
 * The pipe pass never sees this shape, and `of(v)` cannot simply collapse under it either — that would leave
 * `v.subscribe(cb)`, a method call on a plain value. So the source is classified here and the subscription
 * becomes what the shape makes it, exactly as it would at the end of a chain.
 */
function rewriteBareSubscribes(code: string, todos: string[]): string {
  let out: string = code;
  let scan: number = 0;
  for (;;) {
    const at: number = indexOfOutsideStrings(out, '.subscribe', scan);
    if (at < 0) return out;
    const start: number = receiverStart(out, at);
    const folded: Folded = classifySource(out.slice(start, at), todos);
    const tail: { code: string; end: number } | null = folded.shape === 'unknown' ? null : takeSubscribe(out, at, folded, todos);
    if (!tail) {
      scan = at + '.subscribe'.length;
      continue;
    }
    out = out.slice(0, start) + tail.code + out.slice(tail.end);
    scan = start + tail.code.length;
  }
}

/** `.subscribe(cb)` following a folded chain, as the call the shape makes it. Null when there is none to take. */
function takeSubscribe(code: string, at: number, folded: Folded, todos: string[]): { code: string; end: number } | null {
  const m: RegExpMatchArray | null = code.slice(at).match(/^\s*\.subscribe\s*\(/);
  if (!m) return null;
  const open: number = at + m[0].length - 1;
  const close: number = matchClose(code, open);
  if (close < 0) return null;
  const args: string[] = splitTop(code.slice(open + 1, close));
  const cb: string = args[0] ?? '';
  if (args.length > 1 || /^\{/.test(cb.trim())) {
    todos.push('`subscribe` was given an observer with error/complete handlers — only the next-handler is rewritten; put the error branch in a `try`/`catch`');
    return null;
  }
  if (!cb) return { code: folded.code, end: close + 1 };
  const call: string =
    folded.shape === 'array' ? `${wrap(folded.code)}.forEach(${cb})`
    : folded.shape === 'promise' ? `void ${wrap(folded.code)}.then(${cb})`
    : folded.shape === 'value' ? `${wrap(cb)}(${folded.code})`
    : '';
  if (!call) return null;
  return { code: call, end: close + 1 };
}

/** `firstValueFrom(x)` / `lastValueFrom(x)` — the wrappers whose whole job was to leave the stream world. */
function rewriteUnwrappers(code: string, todos: string[]): { code: string; awaited: boolean } {
  let out: string = code;
  let awaited: boolean = false;
  for (const name of ['firstValueFrom', 'lastValueFrom']) {
    for (;;) {
      const at: number = indexOfCallOutsideStrings(out, name);
      if (at < 0) break;
      const open: number = out.indexOf('(', at);
      const close: number = matchClose(out, open);
      if (close < 0) break;
      const inner: string = out.slice(open + 1, close);
      const folded: Folded = classifySource(inner, todos);
      // A source that was already synchronous has nothing to await; anything else is a promise now.
      const replacement: string =
        folded.shape === 'value' ? folded.code
        : folded.shape === 'array' ? (name === 'firstValueFrom' ? `${wrap(folded.code)}[0]` : `${wrap(folded.code)}.at(-1)`)
        : `await ${wrap(inner)}`;
      if (replacement.startsWith('await ')) awaited = true;
      out = out.slice(0, at) + replacement + out.slice(close + 1);
    }
  }
  return { code: out, awaited };
}

/**
 * A source used on its own, with no operators after it — `return of(x)` is `return x`.
 *
 * This runs AFTER the pipe fold on every pass, never before: collapsing `of('home')` first would leave
 * `'home'.pipe(first())`, a receiver the fold can no longer classify, and the chain would survive untranslated.
 */
function rewriteBareSources(code: string, todos: string[]): string {
  let out: string = code;
  let scan: number = 0;
  for (;;) {
    const at: number = indexOfCallOutsideStrings(out, 'of', scan);
    if (at < 0) break;
    const open: number = out.indexOf('(', at);
    const close: number = matchClose(out, open);
    if (close < 0) break;
    // A source whose `.pipe` SURVIVED belongs to a chain the fold refused. Collapsing it anyway would leave
    // `1.pipe(debounceTime(300))` — code that no longer names anything RxJS and no longer parses either.
    if (stillPiped(out, close + 1)) {
      scan = close + 1;
      continue;
    }
    const args: string[] = splitTop(out.slice(open + 1, close));
    const replacement: string = args.length === 0 ? 'undefined' : args.length === 1 ? args[0] : `[${args.join(', ')}]`;
    out = out.slice(0, at) + replacement + out.slice(close + 1);
    scan = 0;
  }
  scan = 0;
  for (;;) {
    const at: number = indexOfCallOutsideStrings(out, 'from', scan);
    if (at < 0) break;
    const open: number = out.indexOf('(', at);
    const close: number = matchClose(out, open);
    if (close < 0) break;
    if (stillPiped(out, close + 1)) {
      scan = close + 1;
      continue;
    }
    const inner: string = out.slice(open + 1, close);
    // `Promise.resolve` and not the bare argument, because the SIGNATURE is decided by what the body says: a
    // body that reads as synchronous gets a synchronous return type, and this one is not.
    const replacement: string = /^\[[\s\S]*\]$/.test(inner.trim()) ? inner : `Promise.resolve(${inner})`;
    if (replacement !== inner) todos.push('`from(…)` was read as wrapping a PROMISE — if its argument was an iterable, drop the `Promise.resolve` and treat it as the array it already is');
    out = out.slice(0, at) + replacement + out.slice(close + 1);
    scan = 0;
  }
  return out.replace(/(?<![\w$.])EMPTY(?![\w$])(?!\s*\.pipe)/g, '[]');
}

/** Whether a `.pipe(` or `.subscribe(` the fold declined to rewrite still hangs off this position. */
function stillPiped(code: string, at: number): boolean {
  return /^\s*\.(?:pipe|subscribe)\s*\(/.test(code.slice(at));
}

/** `needle` at a position that is not inside a string literal, at or after `from`. */
function indexOfOutsideStrings(code: string, needle: string, from: number): number {
  let quote: string = '';
  for (let i: number = 0; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (i >= from && code.startsWith(needle, i)) return i;
  }
  return -1;
}

/** A CALL to `name` — the identifier standing alone (not `x.name`, not `nameish`) and followed by `(`. */
function indexOfCallOutsideStrings(code: string, name: string, from: number = 0): number {
  let quote: string = '';
  for (let i: number = 0; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (i < from || !code.startsWith(name, i)) continue;
    if (i > 0 && /[\w$.]/.test(code[i - 1])) continue;
    const after: string = code.slice(i + name.length);
    if (!/^\s*\(/.test(after)) continue;
    return i;
  }
  return -1;
}

/* ──────────── Subjects → signals ──────────── */

/**
 * A `BehaviorSubject` is a signal with extra ceremony: it holds a current value, every reader sees the same one,
 * and writing notifies. That is a `signal` exactly, so it converts outright rather than through guidance.
 *
 * A bare `Subject` is NOT — it has no current value, and Weave has no multicast primitive — so it becomes a
 * signal that starts undefined and says so. That is the honest shape: the value is there, the fan-out is not.
 */
export function translateSubjects(code: string, todos: string[], extraNames: Iterable<string> = []): string {
  // A METHOD body never contains the field's declaration, so the names have to come from the class the body
  // belongs to. Without them `this.open.next(v)` reads as an ordinary property call and survives the rewrite.
  const names: Set<string> = new Set<string>([...subjectNames(code), ...extraNames]);
  let out: string = code;

  out = out.replace(/new\s+BehaviorSubject\s*(<[\s\S]*?>)?\s*\(/g, (_m, generic: string | undefined) => `signal${generic ?? ''}(`);
  out = out.replace(/new\s+(?:Replay|Async)?Subject\s*(<([\s\S]*?)>)?\s*\(\s*[^)]*\)/g, (_m, _g: string | undefined, inner: string | undefined) => {
    todos.push('a `Subject` had no current value and no Weave equivalent for its fan-out — it is a `signal` starting at `undefined`; every reader already sees every write');
    return `signal<${inner ? `${inner} | undefined` : 'unknown'}>(undefined)`;
  });
  out = out.replace(/new\s+Subject\s*(<([\s\S]*?)>)?\s*\(\s*\)/g, (_m, _g: string | undefined, inner: string | undefined) => {
    todos.push('a `Subject` had no current value and no Weave equivalent for its fan-out — it is a `signal` starting at `undefined`; every reader already sees every write');
    return `signal<${inner ? `${inner} | undefined` : 'unknown'}>(undefined)`;
  });

  if (!names.size) return out;
  const alt: string = [...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // `.next(v)` is a write, `.value`/`.getValue()` is a read, `.asObservable()` was only ever a cast, and
  // `.complete()`/`.unsubscribe()` are teardown the owner performs.
  out = out.replace(new RegExp(`(?<![\\w$])((?:this\\.)?(?:${alt}))\\.next\\s*\\(`, 'g'), '$1.set(');
  out = out.replace(new RegExp(`(?<![\\w$])((?:this\\.)?(?:${alt}))\\.getValue\\s*\\(\\s*\\)`, 'g'), '$1()');
  out = out.replace(new RegExp(`(?<![\\w$])((?:this\\.)?(?:${alt}))\\.value(?![\\w$])`, 'g'), '$1()');
  out = out.replace(new RegExp(`(?<![\\w$])((?:this\\.)?(?:${alt}))\\.asObservable\\s*\\(\\s*\\)`, 'g'), '$1');
  // Teardown is the owner's job, so the calls that performed it have nothing left to do — anchored anywhere on
  // the line, because a `complete()` sitting after another statement is the common shape, not the rare one.
  out = out.replace(new RegExp(`[\\t ]*(?:this\\.)?(?:${alt})\\.(?:complete|unsubscribe)\\s*\\(\\s*\\)\\s*;?`, 'g'), '');
  return out;
}

/** The field/variable names declared as some flavour of Subject, so their `.next`/`.value` can be rewritten. */
export function subjectNames(code: string): Set<string> {
  const names: Set<string> = new Set<string>();
  const decl: RegExp = /(?:readonly\s+|private\s+|public\s+|protected\s+|const\s+|let\s+|var\s+)*([A-Za-z_$][\w$]*)\s*(?::\s*(?:Behavior|Replay|Async)?Subject<[\s\S]*?>)?\s*=\s*new\s+(?:Behavior|Replay|Async)?Subject/g;
  for (const m of code.matchAll(decl)) names.add(m[1]);
  const typed: RegExp = /([A-Za-z_$][\w$]*)\s*:\s*(?:Behavior|Replay|Async)?Subject\s*</g;
  for (const m of code.matchAll(typed)) names.add(m[1]);
  return names;
}

/* ──────────── types ──────────── */

/**
 * `Observable<T>` in a type position → what the translated body actually returns.
 *
 * The annotation is decided by the CODE, not by a table: a body that ends up awaiting or chaining `.then` returns
 * a `Promise<T>`, and one that ends up synchronous returns `T`. A body that still holds RxJS keeps its
 * `Observable<T>`, because changing the signature of something that was not translated is how a migration starts
 * lying about itself.
 */
export function rewriteObservableTypes(code: string, todos: string[]): string {
  let out: string = code;
  let from: number = 0;
  for (;;) {
    const at: number = findTypeAnnotation(out, 'Observable', from);
    if (at < 0) break;
    const open: number = out.indexOf('<', at);
    const close: number = open === at + 'Observable'.length ? matchAngle(out, open) : -1;
    if (close < 0) {
      // A bare `Observable` with no type argument says only "a stream of something".
      out = out.slice(0, at) + 'unknown' + out.slice(at + 'Observable'.length);
      from = at + 'unknown'.length;
      continue;
    }
    const inner: string = out.slice(open + 1, close);
    const body: string = bodyAfter(out, close + 1);
    if (/(?<![\w$])(?:pipe|subscribe|Observable|Subject)(?![\w$])/.test(body)) {
      // Left standing on purpose: renaming the type over an untranslated body would be a lie in the API — the
      // signature would promise a plain value while the code below it still returns a stream.
      todos.push('this signature still returns an `Observable` because its body was not translatable — both have to move together');
      from = close + 1;
      continue;
    }
    const isAsync: boolean = /(?<![\w$])await(?![\w$])|\.then\s*\(|Promise\s*[.<]/.test(body);
    const replacement: string = isAsync ? `Promise<${inner}>` : inner;
    out = out.slice(0, at) + replacement + out.slice(close + 1);
    from = at + replacement.length;
  }
  return out;
}

/** `Observable` used as a TYPE — after `:`, `<`, `as`, or `extends` — rather than as a value. */
function findTypeAnnotation(code: string, name: string, from: number = 0): number {
  let quote: string = '';
  for (let i: number = 0; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (i < from || !code.startsWith(name, i)) continue;
    if (i > 0 && /[\w$.]/.test(code[i - 1])) continue;
    if (/[\w$]/.test(code[i + name.length] ?? '')) continue;
    const before: string = code.slice(Math.max(0, i - 40), i);
    if (!/[:<|&,(]\s*$|\b(?:as|extends|implements)\s+$/.test(before)) continue;
    return i;
  }
  return -1;
}

/** The `>` matching the generic list opened at `open`, or -1. */
function matchAngle(code: string, open: number): number {
  let depth: number = 0;
  for (let i: number = open; i < code.length; i++) {
    const ch: string = code[i];
    if (ch === '<') depth++;
    else if (ch === '>' && --depth === 0) return i;
    else if (ch === ';' || ch === '{' || ch === '}') return -1;
  }
  return -1;
}

/**
 * The function body an annotation belongs to, so the annotation can be decided by it.
 *
 * A PARAMETER's annotation belongs to the enclosing function just as much as the return type does — `settled(src:
 * Observable<string>)` whose body still pipes `src` must keep saying `Observable`. Stopping at the `)` treated the
 * parameter as having no body at all, so it was rewritten to a plain `string` while the `src.pipe(…)` under it
 * stayed exactly where it was: a signature that flatly contradicted its own code.
 */
function bodyAfter(code: string, from: number): string {
  let depth: number = 0;
  for (let i: number = from; i < code.length; i++) {
    const ch: string = code[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ')') {
      if (depth > 0) depth--; // still inside a nested group
      continue; // at depth 0 this closes the parameter list we are inside — the body is past it
    } else if (ch === '{' && depth === 0) {
      const end: number = matchClose(code, i);
      return end < 0 ? code.slice(i) : code.slice(i, end + 1);
    } else if (ch === '=' && code[i + 1] === '>' && depth === 0) {
      // An expression-bodied arrow: the body is the rest of the statement.
      const rest: string = code.slice(i + 2);
      return rest.slice(0, statementLength(rest));
    } else if (depth === 0 && (ch === ';' || (ch === '=' && code[i + 1] !== '>' && code[i - 1] !== '='))) {
      return ''; // a bare declaration or an initializer — there is no body to read
    }
  }
  return '';
}

/** How far a statement runs from position 0: to the first `;` or newline at bracket depth 0. */
function statementLength(code: string): number {
  let depth: number = 0;
  for (let i: number = 0; i < code.length; i++) {
    const ch: string = code[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === '\n')) return i;
  }
  return code.length;
}

/* ──────────── imports + async ──────────── */

/** The packages whose every import this module tries to remove. */
const RX_PACKAGES: RegExp = /^rxjs(?:\/.*)?$|^@angular\/core\/rxjs-interop$/;

/**
 * Drop the RxJS import bindings the translation made dead, and the whole statement when nothing is left.
 *
 * A binding still referenced below is KEPT — an import pruned out from under live code turns a translated file
 * into one that does not compile, which is a worse outcome than a surviving import.
 */
export function pruneRxImports(lines: string[], body: string): { lines: string[]; remaining: string[] } {
  const kept: string[] = [];
  const remaining: Set<string> = new Set<string>();
  for (const line of lines) {
    const m: RegExpMatchArray | null = line.match(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/);
    if (!m || !RX_PACKAGES.test(m[2])) {
      kept.push(line);
      continue;
    }
    const live: string[] = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((binding) => {
        const local: string = binding.split(/\s+as\s+/).pop()?.trim() ?? binding;
        return new RegExp(`(?<![\\w$.])${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(withoutImports(body));
      });
    for (const l of live) remaining.add(l.split(/\s+as\s+/).pop()?.trim() ?? l);
    if (live.length) kept.push(`import { ${live.join(', ')} } from '${m[2]}';`);
  }
  return { lines: kept, remaining: [...remaining].sort() };
}

/**
 * Comments are not uses: the original chain carried beside a rewrite must not hold its own import alive.
 *
 * A TRAILING `//` counts as much as one at the start of a line — the drafts put the original on the same line as
 * often as above it — but a `://` inside a URL is not a comment and must not eat the rest of the line.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The code minus its own import statements.
 *
 * An import is not a use. When the file being tested IS the whole file — a carried module, where the imports sit
 * inline rather than in a separate list — every rxjs binding looked live because it appeared in the very line
 * being judged, so nothing was ever pruned and every carried file kept its `rxjs` dependency.
 */
function withoutImports(code: string): string {
  return stripComments(code).replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm, '');
}

/**
 * Mark the functions whose body the rewrite gave an `await` as `async`.
 *
 * `firstValueFrom(x)` became `await x`, and an `await` in a synchronous function does not compile — so the
 * signature has to follow the body. Only the declaration forms this migration emits are handled; anything else
 * is left for the type-check pass to surface rather than rewritten blind.
 */
export function asyncifyAwaiters(code: string): string {
  const forms: RegExp[] = [
    /(?<![\w$])(?<!async\s)(function\s+[A-Za-z_$][\w$]*\s*\()/g,
    /((?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*)(\([^)]*\)\s*(?::\s*[^=]*?)?=>)/g,
  ];
  const src: string = code;
  // `function name(…) { … await … }` — the parameter list is skipped by matching its bracket, because a
  // destructured parameter puts a `{` before the body and would otherwise be mistaken for it.
  let out: string = src.replace(forms[0], (m, head: string, at: number) => {
    const params: number = matchClose(src, at + head.length - 1);
    return awaitsIn(src, params) ? `async ${head}` : m;
  });
  // `const name = (…) => { … await … }`
  out = out.replace(forms[1], (m, head: string, arrow: string, at: number) => {
    if (/(?<![\w$])async\s*\(/.test(arrow)) return m;
    return awaitsIn(out, at + m.length - 1) ? `${head}async ${arrow}` : m;
  });
  return out;
}

/** Whether the block starting at the first `{` after `from` contains an `await`. */
function awaitsIn(code: string, from: number): boolean {
  if (from < 0) return false;
  const brace: number = code.indexOf('{', from);
  if (brace < 0) return false;
  const end: number = matchClose(code, brace);
  return end > 0 && /(?<![\w$])await(?![\w$])/.test(code.slice(brace, end + 1));
}

/**
 * The whole translation over one blob: subjects, chains, types, and the `async` the rewrite implies.
 *
 * Callers hand this a class body, a service draft, or a whole carried file — it is the same job either way, and
 * the RxJS names still standing afterwards are reported so the caller can say which ones survived and why.
 */
export function rxToWeave(code: string, subjects: Iterable<string> = []): { code: string; todos: string[] } {
  const todos: string[] = [];
  const out: string = translateSubjects(code, todos, subjects);
  const rest: { code: string; todos: string[] } = rxAfterSubjects(out);
  return { code: rest.code, todos: [...new Set([...todos, ...rest.todos])] };
}

/**
 * Everything except the Subject rewrite — for callers that already did that part.
 *
 * A class body is translated in two halves: the Subject rewrite has to run while `this.` prefixes are still
 * intact (`this.open.next(v)`), and the chain rewrite has to run after the renames, when the receivers are the
 * Weave names. Splitting the entry point is what lets a caller sit in between.
 */
export function rxAfterSubjects(code: string): { code: string; todos: string[] } {
  const todos: string[] = [];
  const rx: RxResult = translateRx(code);
  let out: string = rewriteObservableTypes(rx.code, todos);
  if (rx.introducedAwait) out = asyncifyAwaiters(out);
  return { code: out, todos: [...new Set([...rx.todos, ...todos])] };
}

/** The RxJS names still standing in a finished draft — what the migration owes the reader an explanation for. */
export function survivingRxNames(code: string, candidates: string[]): string[] {
  const live: string = withoutImports(code);
  return [...new Set(candidates)].filter((n) => new RegExp(`(?<![\\w$.])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(live)).sort();
}
