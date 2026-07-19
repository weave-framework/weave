/**
 * @weave-framework/store — built-in state management.
 * Zero third-party dependencies (only `@weave-framework/runtime`, for `root`).
 *
 * A store is just a lazily-instantiated singleton bag of signals + actions.
 * Because the state IS signals, any component that reads it updates surgically —
 * no selectors, no reducers, no context plumbing, no boilerplate. (TypeScript
 * port of v0.1 `src/store.js`, behaviour identical, now fully typed.)
 */

import { root } from '@weave-framework/runtime';

/**
 * Define a global store. The `factory` runs once, lazily, on first use; every
 * caller then shares that one instance.
 *
 * ```ts
 * const useCart = store(() => {
 *   const items = signal<Item[]>([]);
 *   const total = computed(() => items().reduce((s, i) => s + i.price, 0));
 *   return { items, total, add: (i: Item) => items.set((xs) => [...xs, i]) };
 * });
 * const cart = useCart();           // same instance everywhere
 * ```
 */
export function store<T extends object>(factory: () => T): () => T {
  let instance: T | undefined;
  // Created in its OWN root, not under whatever owner happened to call first. A store is an app-lifetime
  // singleton, but `factory()` ran synchronously inside the first consuming component's owner, so every
  // effect/watch/computed created inside it registered its disposer there — and unmounting that one
  // component permanently killed them, while every other consumer went on holding the same half-dead
  // instance. Silent and order-dependent: the signals keep working, so the store still looks alive.
  // `optimistic()` uses `watch` internally, so a store-created optimistic never cleared its overlay again.
  //
  // The root is deliberately never disposed — that IS the store's lifetime. Nothing here leaks per-consumer:
  // one instance exists for the life of the app, which is what a global store means.
  return () => (instance ??= root(() => factory()));
}
