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
  /** Owner at creation — an effect routes a thrown error up this chain (error boundary). */
  owner?: Owner | null;
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
  let threw = false;
  let error: unknown;
  try {
    const result = c.fn();
    if (c.isMemo) {
      if (!c.equals(c.value, result)) {
        c.value = result;
        for (const o of c.observers) o.state = DIRTY;
      }
    }
  } catch (e) {
    threw = true;
    error = e;
  } finally {
    listener = prev;
    c.state = CLEAN;
  }
  if (threw) {
    // Effects route to the nearest error boundary; a memo propagates to its reader.
    if (c.isEffect) handleError(error, c.owner ?? null);
    else throw error;
  }
}

/** Walk the owner chain to the nearest error boundary; rethrow if there is none. */
function handleError(err: unknown, owner: Owner | null): void {
  let o = owner;
  while (o) {
    if (o._onError) {
      o._onError(err);
      return;
    }
    o = o._parent;
  }
  throw err;
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
    owner: currentOwner,
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
  /**
   * The ambient owner captured at creation time. `inject` walks this chain to
   * find a provided context value — independent of the disposal wiring, so a
   * control-flow block (created with `parent: null`) still inherits context.
   */
  _parent: Owner | null;
  /** Lazily-created context value map (`provide`/`inject`). Keyed by context identity. */
  _contexts?: Map<object, unknown>;
  /** Set once disposed, so a deferred `onMount` can skip a scope that already unmounted. */
  _disposed?: boolean;
  /** Error-boundary handler — a thrown error in this subtree's effects/render routes here. */
  _onError?: (err: unknown) => void;
}

/** Create an ownership scope, optionally linked to a parent that disposes it. */
export function createOwner(parent: Owner | null = null): Owner {
  // `_parent` captures the *ambient* owner (for context lookup); the explicit
  // `parent` argument only wires disposal. In every call site they coincide or
  // the ambient one is the correct context parent.
  const owner: Owner = { _disposers: [], _parent: currentOwner };
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
  owner._disposed = true;
  const ds = owner._disposers.splice(0);
  for (let i = ds.length - 1; i >= 0; i--) ds[i]();
}

/** Register an arbitrary teardown with the active ownership scope. */
export function onDispose(fn: () => void): void {
  if (currentOwner) currentOwner._disposers.push(fn);
}

/**
 * Run `fn` after the current component's DOM has been inserted — on the next
 * microtask, once the synchronous construct-and-mount pass has finished. Return a
 * cleanup function (or call `onDispose` inside) to tear down on unmount. The callback
 * runs in the owner scope active at registration, so `onDispose`/`onCleanup` inside it
 * tie to that scope; it is skipped entirely if the scope is disposed (unmounted)
 * before the microtask fires. No-op cleanup tie-in outside an owner scope.
 */
export function onMount(fn: () => void | (() => void)): void {
  const owner = currentOwner;
  queueMicrotask(() => {
    if (owner && owner._disposed) return;
    runInOwner(owner, () => {
      const cleanup = fn();
      if (typeof cleanup === 'function') onDispose(cleanup);
    });
  });
}

/**
 * Run `fn` inside a child owner whose effects (and synchronous render errors) are caught
 * by `handler` instead of propagating. The handler can read the error and trigger a
 * fallback (e.g. set a signal). Powers the `ErrorBoundary` component; usable directly for
 * programmatic boundaries. The boundary owner is disposed with the surrounding scope.
 */
export function catchError<T>(handler: (err: unknown) => void, fn: () => T): T | undefined {
  const owner = createOwner(); // _parent = currentOwner (so inner effects route here)
  owner._onError = handler;
  if (currentOwner) currentOwner._disposers.push(() => disposeOwner(owner));
  try {
    return runInOwner(owner, fn);
  } catch (err) {
    handler(err); // synchronous error thrown during `fn` itself
    return undefined;
  }
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

/**
 * Resolve after pending microtask-scheduled work has run — `onMount` callbacks,
 * deferred `ErrorBoundary` swaps, etc. Reactive updates in Weave are **synchronous**
 * (the DOM is already current right after a `signal.set` outside a `batch`), so
 * `await tick()` is for waiting on that microtask-queued work before reading the DOM
 * — the analog of Svelte's `tick()` / Vue's `nextTick()`. If called inside a `batch`,
 * the queued effects flush first, then the microtask resolves.
 */
export function tick(): Promise<void> {
  flush(); // defensive: drain any queued effects (no-op when not batching)
  return new Promise((resolve) => queueMicrotask(resolve));
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
