import { signal, computed, type Signal } from '@weave-framework/runtime';
import { store } from '@weave-framework/store';
import Counter from './store-shared-panel';

// The child tag in the template resolves to this import.
void Counter;

/**
 * One store, read by three independent components — the claim the page makes in one line and never shows.
 *
 * `useCart()` is called separately inside each panel. They share state not because anything wires them
 * together, but because `store()` hands every caller the SAME object: one lazily-created slot behind a
 * closure. The "created" counter proves that the factory ran once, however many components asked.
 */
let factoryRuns = 0;

export const useCart = store(() => {
  factoryRuns += 1;
  const items: Signal<string[]> = signal<string[]>([]);
  const add = (name: string): void => {
    items.set((l) => [...l, name]);
  };
  const clear = (): void => {
    items.set([]);
  };
  return { items, add, clear, total: computed((): number => items().length) };
});

export function setup() {
  const cart = useCart();
  const runs = (): number => factoryRuns;
  const panels = ['Shop', 'Header', 'Sidebar'];
}
