// @ts-check
/**
 * Weave — built-in state management.
 *
 * No external library, no boilerplate. A store is a singleton factory of signals
 * and actions. Because state is just signals, any component reading it is
 * automatically and surgically updated — exactly the "built-in state management
 * with signals" the analysis listed as a top wish for React.
 */

/**
 * Define a global store. The factory runs once, lazily, on first use.
 *   const useCart = store(() => {
 *     const items = signal([]);
 *     const total = computed(() => items().reduce((s, i) => s + i.price, 0));
 *     return { items, total, add: (i) => items.set((xs) => [...xs, i]) };
 *   });
 *   const cart = useCart();
 * @template T
 * @param {() => T} factory
 * @returns {() => T}
 */
export function store(factory) {
  let instance;
  return () => {
    if (instance === undefined) instance = factory();
    return instance;
  };
}
