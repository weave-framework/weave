/**
 * Weave — reactive core (TypeScript port of v0.1 `src/reactive.js`, behavior identical).
 *
 * Fine-grained signals. No dependency arrays, no RxJS, no Virtual DOM. This is
 * the single primitive the whole framework is built on, answering the analysis's
 * #1 finding: every modern framework is converging on signals.
 *
 * Algorithm: a push-pull reactive graph with three node states (CLEAN / CHECK /
 * DIRTY). Writes push "maybe-dirty" (CHECK) downstream cheaply; reads pull to
 * verify, recomputing memos lazily and only when a source actually changed.
 * Diamond graphs are glitch-free (a node never recomputes twice for one update)
 * and memos stay cached until a true dependency changes.
 */

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;
type State = typeof CLEAN | typeof CHECK | typeof DIRTY;

/** A trackable value: a signal or a memo. */
interface Source {
  observers: Set<Computation>;
  /** present on memos: bring this source up to date before reading it */
  update?: () => void;
}

/** A reactive computation: an effect or a memo. */
interface Computation extends Source {
  fn: () => unknown;
  sources: Set<Source>;
  state: State;
  isMemo: boolean;
  isEffect: boolean;
  value: unknown;
  equals: (a: unknown, b: unknown) => boolean;
  cleanups: Array<() => void>;
}

/** The computation currently collecting dependencies. */
let listener: Computation | null = null;
/** The ownership scope effects register into, so a block can dispose them on unmount. */
let currentOwner: Owner | null = null;
/** Batch nesting depth. While > 0, effects are queued, not run. */
let batchDepth = 0;
/** Effects scheduled to run once the current batch unwinds. */
const queue = new Set<Computation>();

/** Register an edge from `source` to the active listener, if any. */
function track(source: Source): void {
  if (listener) {
    source.observers.add(listener);
    listener.sources.add(source);
  }
}

/** A source changed: direct observers are DIRTY; everything downstream is CHECK. */
function markDirty(node: Computation): void {
  if (node.state === DIRTY) return;
  node.state = DIRTY;
  propagate(node);
}

function markCheck(node: Computation): void {
  if (node.state !== CLEAN) return;
  node.state = CHECK;
  propagate(node);
}

function propagate(node: Computation): void {
  if (node.isEffect) {
    queue.add(node);
    return;
  }
  for (const o of node.observers) markCheck(o);
}

function notify(observers: Set<Computation>): void {
  for (const o of [...observers]) markDirty(o);
}

/** Detach a computation from its current sources before it re-runs. */
function unlink(c: Computation): void {
  for (const s of c.sources) s.observers.delete(c);
  c.sources.clear();
}

function dispose(c: Computation): void {
  for (const fn of c.cleanups) fn();
  c.cleanups.length = 0;
}

/** Recompute a memo/effect, re-tracking its dependencies. */
function run(c: Computation): void {
  dispose(c);
  unlink(c);
  const prev = listener;
  listener = c;
  try {
    const result = c.fn();
    if (c.isMemo) {
      if (!c.equals(c.value, result)) {
        c.value = result;
        for (const o of c.observers) o.state = DIRTY;
      }
    }
  } finally {
    listener = prev;
    c.state = CLEAN;
  }
}

/** Pull: bring a memo up to date only if a real source changed (lazy, glitch-free). */
function updateIfNecessary(c: Computation): void {
  if (c.state === CHECK) {
    for (const src of c.sources) {
      src.update?.(); // may mutate c.state to DIRTY via the reactive graph
      if ((c.state as State) === DIRTY) break;
    }
    if ((c.state as State) === CHECK) c.state = CLEAN;
  }
  if ((c.state as State) === DIRTY) run(c);
}

/** Run queued effects (called when the outermost batch unwinds). */
function flush(): void {
  if (batchDepth > 0) return;
  for (const e of queue) {
    queue.delete(e);
    if (e.state !== CLEAN) updateIfNecessary(e);
  }
}

/** A readable + writable reactive value. Call it to read (and subscribe). */
export interface Signal<T> {
  (): T;
  set(next: T | ((prev: T) => T)): T;
  update(fn: (prev: T) => T): T;
  peek(): T;
}

/** A cached derived value. Read-only. */
export type Computed<T> = () => T;

/** Create a reactive value. */
export function signal<T>(initial: T, opts: { equals?: (a: T, b: T) => boolean } = {}): Signal<T> {
  const node: Source & { value: T; equals: (a: T, b: T) => boolean } = {
    value: initial,
    observers: new Set(),
    equals: opts.equals || Object.is,
  };
  const read = (() => {
    track(node);
    return node.value;
  }) as Signal<T>;
  read.set = (next) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(node.value) : next;
    if (node.equals(node.value, value)) return node.value;
    node.value = value;
    notify(node.observers);
    flush();
    return value;
  };
  read.update = (fn) => read.set(fn);
  read.peek = () => node.value;
  return read;
}

/**
 * A cached derived value. Recomputes lazily, only when a dependency changed.
 * No manual memoization (useMemo / useCallback) is ever needed.
 */
export function computed<T>(fn: () => T, opts: { equals?: (a: T, b: T) => boolean } = {}): Computed<T> {
  const c: Computation = {
    fn: fn as () => unknown,
    sources: new Set(),
    observers: new Set(),
    state: DIRTY,
    isMemo: true,
    isEffect: false,
    value: undefined,
    equals: (opts.equals as (a: unknown, b: unknown) => boolean) || Object.is,
    cleanups: [],
  };
  c.update = () => updateIfNecessary(c);
  return () => {
    updateIfNecessary(c);
    track(c);
    return c.value as T;
  };
}

/**
 * Run a side effect that re-runs automatically when anything it reads changes.
 * Dependencies are tracked automatically — there is no dependency array, ever.
 * Return a cleanup function from `fn`, or call `onCleanup`, to tear down.
 */
export function effect(fn: () => void | (() => void)): () => void {
  const c: Computation = {
    fn: () => {
      const ret = fn();
      if (typeof ret === 'function') c.cleanups.push(ret);
    },
    sources: new Set(),
    observers: new Set(),
    state: DIRTY,
    isMemo: false,
    isEffect: true,
    value: undefined,
    equals: Object.is,
    cleanups: [],
  };
  run(c);
  const stop = () => {
    dispose(c);
    unlink(c);
    c.state = CLEAN;
    queue.delete(c);
  };
  // Register with the active ownership scope so a block tears this effect down on unmount.
  if (currentOwner) currentOwner._disposers.push(stop);
  return stop;
}

/* ──────────────────────────── ownership ──────────────────────────── */

/**
 * An ownership scope. Effects created while it is active register their teardown
 * here, so a control-flow block (`@if`/`@for`) can dispose every nested effect
 * when its branch/row unmounts — preventing leaks.
 */
export interface Owner {
  _disposers: Array<() => void>;
}

/** Create an ownership scope, optionally linked to a parent that disposes it. */
export function createOwner(parent: Owner | null = null): Owner {
  const owner: Owner = { _disposers: [] };
  if (parent) parent._disposers.push(() => disposeOwner(owner));
  return owner;
}

/** Run `fn` with `owner` active; effects created inside register into it. */
export function runInOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

/** Dispose every effect/child owner registered in `owner` (children first, LIFO). */
export function disposeOwner(owner: Owner): void {
  const ds = owner._disposers.splice(0);
  for (let i = ds.length - 1; i >= 0; i--) ds[i]();
}

/** Register an arbitrary teardown with the active ownership scope. */
export function onDispose(fn: () => void): void {
  if (currentOwner) currentOwner._disposers.push(fn);
}

/** The current ownership scope, if any. */
export function getOwner(): Owner | null {
  return currentOwner;
}

/** Run `fn` inside a fresh root owner; returns the result and a dispose handle. */
export function root<T>(fn: (dispose: () => void) => T): T {
  const owner = createOwner();
  return runInOwner(owner, () => fn(() => disposeOwner(owner)));
}

/** Group multiple writes so dependent effects run once, after all of them. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
}

/** Read reactive values without subscribing the current computation to them. */
export function untrack<T>(fn: () => T): T {
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
 */
export function onCleanup(fn: () => void): void {
  if (listener) listener.cleanups.push(fn);
}
