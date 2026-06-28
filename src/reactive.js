// @ts-check
/**
 * Weave — reactive core.
 *
 * Fine-grained signals. No dependency arrays, no RxJS, no Virtual DOM.
 * This is the single primitive the whole framework is built on, answering the
 * #1 finding of the analysis: every modern framework is converging on signals.
 *
 * Algorithm: a push-pull reactive graph with three node states (CLEAN / CHECK /
 * DIRTY). Writes push "maybe-dirty" (CHECK) downstream cheaply; reads pull to
 * verify, recomputing memos lazily and only when a source actually changed.
 * This makes diamond graphs glitch-free — a node never recomputes twice for one
 * update — and keeps memos cached until something they depend on truly changes.
 */

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

/** The computation currently collecting dependencies (effect or memo). */
let listener = null;
/** Batch nesting depth. While > 0, effects are queued, not run. */
let batchDepth = 0;
/** Effects scheduled to run once the current batch unwinds. */
const queue = new Set();

/**
 * @typedef {Object} Source  A trackable value (signal or memo).
 * @property {Set<Computation>} observers
 */

/**
 * @typedef {Object} Computation  A reactive computation (effect or memo).
 * @property {() => any} fn
 * @property {Set<Source>} sources
 * @property {Set<Computation>} [observers]  present when the computation is also a memo
 * @property {number} state
 * @property {boolean} isMemo
 * @property {boolean} isEffect
 * @property {any} value
 * @property {(a:any,b:any)=>boolean} equals
 * @property {Array<() => void>} cleanups
 */

/** Register an edge from `source` to the active listener, if any. */
function track(source) {
  if (listener) {
    source.observers.add(listener);
    listener.sources.add(source);
  }
}

/** A source changed: its direct observers are DIRTY; everything downstream is CHECK. */
function markDirty(node) {
  if (node.state === DIRTY) return;
  node.state = DIRTY;
  propagate(node);
}

function markCheck(node) {
  if (node.state !== CLEAN) return;
  node.state = CHECK;
  propagate(node);
}

function propagate(node) {
  if (node.isEffect) {
    queue.add(node);
    return;
  }
  if (node.observers) {
    for (const o of node.observers) markCheck(o);
  }
}

function notify(observers) {
  for (const o of [...observers]) markDirty(o);
}

/** Detach a computation from its current sources before it re-runs. */
function unlink(c) {
  for (const s of c.sources) s.observers.delete(c);
  c.sources.clear();
}

function dispose(c) {
  for (const fn of c.cleanups) fn();
  c.cleanups.length = 0;
}

/** Recompute a memo/effect, re-tracking its dependencies. */
function run(c) {
  dispose(c);
  unlink(c);
  const prev = listener;
  listener = c;
  try {
    const result = c.fn();
    if (c.isMemo) {
      if (!c.equals(c.value, result)) {
        c.value = result;
        // value actually changed → promote downstream CHECKs to DIRTY
        if (c.observers) for (const o of c.observers) o.state = DIRTY;
      }
    }
  } finally {
    listener = prev;
    c.state = CLEAN;
  }
}

/** Pull: bring a memo up to date only if a real source changed (lazy + glitch-free). */
function updateIfNecessary(c) {
  if (c.state === CHECK) {
    for (const src of c.sources) {
      if (src.update) src.update(); // src is itself a memo → verify it first
      // @ts-ignore — once a source recomputes to a new value it sets us DIRTY
      if (c.state === DIRTY) break;
    }
    if (c.state === CHECK) c.state = CLEAN;
  }
  if (c.state === DIRTY) run(c);
}

/** Run queued effects (called when the outermost batch unwinds). */
function flush() {
  if (batchDepth > 0) return;
  for (const e of queue) {
    queue.delete(e);
    if (e.state !== CLEAN) updateIfNecessary(e);
  }
}

/**
 * Create a reactive value.
 * @template T
 * @param {T} initial
 * @param {{ equals?: (a:T,b:T)=>boolean }} [opts]
 * @returns {import('./types').Signal<T>}
 */
export function signal(initial, opts = {}) {
  const node = {
    value: initial,
    observers: new Set(),
    equals: opts.equals || Object.is,
  };
  const read = () => {
    track(node);
    return node.value;
  };
  /** @param {any} next */
  read.set = (next) => {
    if (typeof next === 'function') next = next(node.value);
    if (node.equals(node.value, next)) return node.value;
    node.value = next;
    notify(node.observers);
    flush();
    return next;
  };
  read.update = (fn) => read.set(fn);
  read.peek = () => node.value;
  return read;
}

/**
 * A cached derived value. Recomputes lazily, only when a dependency changed.
 * No manual memoization (useMemo / useCallback) is ever needed.
 * @template T
 * @param {() => T} fn
 * @param {{ equals?: (a:T,b:T)=>boolean }} [opts]
 * @returns {() => T}
 */
export function computed(fn, opts = {}) {
  /** @type {any} */
  const c = {
    fn,
    sources: new Set(),
    observers: new Set(),
    state: DIRTY,
    isMemo: true,
    isEffect: false,
    value: undefined,
    equals: opts.equals || Object.is,
    cleanups: [],
  };
  c.update = () => updateIfNecessary(c);
  const read = () => {
    updateIfNecessary(c);
    track(c);
    return c.value;
  };
  return read;
}

/**
 * Run a side effect that re-runs automatically when anything it reads changes.
 * Dependencies are tracked automatically — there is no dependency array, ever.
 * Return a cleanup function from `fn`, or call `onCleanup`, to tear down.
 * @param {() => (void | (() => void))} fn
 * @returns {() => void} dispose
 */
export function effect(fn) {
  /** @type {any} */
  const c = {
    fn: () => {
      const ret = fn();
      if (typeof ret === 'function') c.cleanups.push(ret);
    },
    sources: new Set(),
    observers: null,
    state: DIRTY,
    isMemo: false,
    isEffect: true,
    value: undefined,
    equals: Object.is,
    cleanups: [],
  };
  run(c);
  return () => {
    dispose(c);
    unlink(c);
    c.state = CLEAN;
    queue.delete(c);
  };
}

/**
 * Group multiple writes so dependent effects run once, after all of them.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
}

/**
 * Read reactive values without subscribing the current computation to them.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function untrack(fn) {
  const prev = listener;
  listener = null;
  try {
    return fn();
  } finally {
    listener = prev;
  }
}

/**
 * Register a teardown for the current effect/memo. Runs before the next
 * re-execution and on dispose. No-op outside a reactive computation.
 * @param {() => void} fn
 */
export function onCleanup(fn) {
  if (listener) listener.cleanups.push(fn);
}
