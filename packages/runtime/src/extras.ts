/**
 * Reactive extras — small conveniences over the core primitives. Each is a thin,
 * tree-shakeable wrapper around `signal`/`effect`/`untrack`/`onCleanup`; none of
 * them touch the reactive graph internals, so the core stays minimal and these
 * only ship when imported.
 *
 *  - `linkedSignal`   — a writable signal that *resets* from a source.
 *  - `debounced`      — a read-only value that trails its source by `ms`.
 *  - `watch`          — an effect with old/new values + explicit source.
 *  - `fromObservable` — bridge an RxJS/Angular Observable INTO a Weave reactive value.
 *  - `toObservable`   — bridge a Weave source OUT to a minimal Observable (async pipe / rxjs).
 */

import { signal, effect, untrack, onCleanup, onDispose, root } from './reactive.js';
import type { Signal, Computed } from './reactive.js';

/**
 * A writable signal whose value is *derived* from `source`: it can be set locally,
 * but every time `source` changes the local value is overwritten with the fresh
 * one. The canonical use is "reset the selection when the list changes":
 *
 * ```ts
 * const selected = linkedSignal(() => items()[0]);
 * selected.set(items()[2]); // local override
 * // …items() changes → selected resets to the new items()[0]
 * ```
 *
 * Owner-scoped (the internal effect disposes with the surrounding region).
 */
export function linkedSignal<T>(
  source: () => T,
  opts: { equals?: (a: T, b: T) => boolean } = {}
): Signal<T> {
  const sig: Signal<T> = signal<T>(untrack(source), opts);
  effect(() => {
    sig.set(source()); // tracks `source`; resets the (possibly overridden) value
  });
  return sig;
}

/**
 * A read-only value that trails `source` by `ms` milliseconds: it updates only
 * after `source` has been quiet for `ms` (each change restarts the timer). Ideal
 * for search-as-you-type. The initial value is seeded immediately (no delay).
 *
 * ```ts
 * const q = signal('');
 * const dq = debounced(q, 300); // dq() lags q() by 300ms of quiet
 * ```
 *
 * Owner-scoped; the pending timeout is cleared on each change and on unmount.
 */
export function debounced<T>(source: () => T, ms: number): Computed<T> {
  const sig: Signal<T> = signal<T>(untrack(source));
  effect(() => {
    const v: T = source(); // track the source
    const id: ReturnType<typeof setTimeout> = setTimeout(() => sig.set(v), ms);
    onCleanup(() => clearTimeout(id)); // a new change (or unmount) cancels the pending write
  });
  return () => sig();
}

/**
 * Run `cb(value, prev)` whenever `source` changes — an effect with an explicit
 * source and access to the previous value. Unlike a bare `effect`, only `source`
 * is tracked (the callback's own reads do not subscribe). Lazy by default; pass
 * `immediate` to also fire on creation (with `prev === undefined`). The callback
 * may return a cleanup that runs before the next call and on stop.
 *
 * Returns a stop handle (also disposed with the surrounding owner).
 */
export function watch<T>(
  source: () => T,
  cb: (value: T, prev: T | undefined) => void | (() => void),
  opts: { immediate?: boolean } = {}
): () => void {
  let prev: T | undefined;
  let first: boolean = true;
  return effect(() => {
    const value: T = source(); // the ONLY tracked read
    let ret: (() => void) | undefined;
    untrack(() => {
      let r: unknown = undefined;
      if (first) {
        first = false;
        if (opts.immediate) r = cb(value, undefined);
      } else {
        r = cb(value, prev);
      }
      if (typeof r === 'function') ret = r as () => void;
      prev = value;
    });
    if (ret) onCleanup(ret);
  });
}

/* ─────────────────── Observable interop (Angular / RxJS migration bridge) ─────────────────── */

/** A partial observer — matches RxJS/Angular's `Observer` (every callback optional). */
export interface InteropObserver<T> {
  next?: (value: T) => void;
  error?: (err: unknown) => void;
  complete?: () => void;
}

/** A subscription teardown — RxJS `Subscription` / Angular `Unsubscribable`. */
export interface Unsubscribable {
  unsubscribe(): void;
}

/**
 * The minimal Observable contract Weave bridges to/from: anything with a `subscribe`
 * that takes an observer and returns a teardown (an object with `unsubscribe()` or a
 * bare function). RxJS `Observable`/`Subject`, an Angular `HttpClient` result, and any
 * interop observable satisfy it — so the bridge needs **no `rxjs` dependency**.
 */
export interface Subscribable<T> {
  subscribe(observer: InteropObserver<T>): Unsubscribable | (() => void);
}

/** Normalize a `subscribe()` return (teardown object or bare fn) to a single call. */
function teardown(sub: Unsubscribable | (() => void)): void {
  if (typeof sub === 'function') sub();
  else if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
}

/**
 * Bridge an RxJS/Angular-style Observable **into** a Weave reactive value. Subscribes to
 * `observable` and pushes each emission into a read-only accessor; auto-unsubscribes when
 * the surrounding owner (component) disposes. The accessor returns `initial` (or
 * `undefined`) until the first emission. If the stream errors, the error is re-thrown on
 * the next read, so it routes to a `catchError` boundary or a local try/catch.
 *
 * Call it inside a component/owner scope so the auto-unsubscribe fires on unmount.
 *
 * ```ts
 * const user = fromObservable(http.get<User>('/me')); // http.get returns an Observable
 * // template: @if (user()) { {{ user()!.name }} }
 * ```
 */
export function fromObservable<T>(observable: Subscribable<T>, initial?: T): () => T | undefined {
  const value: Signal<T | undefined> = signal<T | undefined>(initial);
  const failure: Signal<{ err: unknown } | null> = signal<{ err: unknown } | null>(null);
  const sub: Unsubscribable | (() => void) = observable.subscribe({
    // Wrap in an updater so a function-valued emission is stored verbatim (a bare
    // function passed to `signal.set` would be treated as an updater, not a value).
    // Block bodies: `signal.set` returns the value, so an expression arrow would break the `: void`.
    next: (v: T): void => {
      value.set(() => v);
    },
    error: (err: unknown): void => {
      failure.set({ err });
    },
  });
  onDispose(() => teardown(sub));
  return (): T | undefined => {
    const f: { err: unknown } | null = failure();
    if (f) throw f.err;
    return value();
  };
}

/** Best-effort `Symbol.observable` key so `rxjs.from()` and interop libs recognize the bridge. */
const OBSERVABLE_KEY: symbol =
  (typeof Symbol === 'function' && (Symbol as { observable?: symbol }).observable) || Symbol.for('@@observable');

/**
 * Bridge a Weave reactive source (signal / computed / getter) **out** to a minimal
 * Observable. Each `subscribe(observer)` starts an isolated effect that emits `source()`
 * — the current value immediately, then on every change — and returns an `unsubscribe`
 * that stops it. Duck-typed to the RxJS/Angular Observable contract (plus the
 * `Symbol.observable` interop hook), so Angular's `async` pipe and `rxjs.from(...)`
 * accept it directly.
 *
 * ```ts
 * const count = signal(0);
 * const count$ = toObservable(count); // hand to an Angular async pipe / rxjs
 * ```
 */
export function toObservable<T>(source: () => T): Subscribable<T> {
  const observable: Subscribable<T> = {
    subscribe(observer: InteropObserver<T>): Unsubscribable {
      // Isolated root so ONLY unsubscribe ends the stream (not some ambient owner).
      let stop: () => void = (): void => {};
      root((dispose: () => void): void => {
        stop = dispose;
        effect(() => observer.next?.(source()));
      });
      return { unsubscribe: stop };
    },
  };
  (observable as unknown as Record<symbol, unknown>)[OBSERVABLE_KEY] = function (this: unknown): unknown {
    return this;
  };
  return observable;
}
