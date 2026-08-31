import { signal, computed, untrack } from '@weave-framework/runtime';

/**
 * A computed is LAZY and CACHED, and both halves are invisible until something counts.
 *
 * `runs` is incremented inside the derivation itself, so the number on screen is literally how many
 * times the body has executed. Reading the value ten times with the source unchanged moves it once —
 * that is the cache. Leaving it unread moves it not at all — that is the laziness, and it is the reason
 * a side effect smuggled into a computed may never happen.
 *
 * The counter is written with `untrack` so incrementing it does not make the derivation depend on its
 * own bookkeeping.
 */
export function setup() {
  const n = signal(2);
  const runs = signal(0);
  const reads = signal(0);
  const lastValue = signal<string>('(never read)');

  const doubled = computed((): number => {
    untrack(() => runs.set((r) => r + 1));
    return n() * 2;
  });

  const read = (): void => {
    const v = doubled();
    reads.set((r) => r + 1);
    lastValue.set(String(v));
  };
  const bump = (): void => {
    n.set((v) => v + 1);
  };
  const reset = (): void => {
    untrack(() => {
      runs.set(0);
      reads.set(0);
    });
  };
}
