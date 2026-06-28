/**
 * Reactive extras — small conveniences over the core primitives. Each is a thin,
 * tree-shakeable wrapper around `signal`/`effect`/`untrack`/`onCleanup`; none of
 * them touch the reactive graph internals, so the core stays minimal and these
 * only ship when imported.
 *
 *  - `linkedSignal` — a writable signal that *resets* from a source (Angular).
 *  - `debounced`    — a read-only value that trails its source by `ms` (Vue/util).
 *  - `watch`        — an effect with old/new values + explicit source (Vue).
 */

import { signal, effect, untrack, onCleanup } from './reactive.js';
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
  const sig = signal<T>(untrack(source), opts);
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
  const sig = signal<T>(untrack(source));
  effect(() => {
    const v = source(); // track the source
    const id = setTimeout(() => sig.set(v), ms);
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
  let first = true;
  return effect(() => {
    const value = source(); // the ONLY tracked read
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
