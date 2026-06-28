/**
 * @weave/store — built-in state management. Zero dependencies.
 *
 * A store is just a lazily-instantiated singleton bag of signals + actions.
 * Because the state IS signals, any component that reads it updates surgically —
 * no selectors, no reducers, no context plumbing, no boilerplate. (TypeScript
 * port of v0.1 `src/store.js`, behaviour identical, now fully typed.)
 */

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
  return () => (instance ??= factory());
}
