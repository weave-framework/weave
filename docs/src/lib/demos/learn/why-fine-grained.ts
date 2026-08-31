import { signal, computed, effect, untrack, type Signal } from '@weave-framework/runtime';

/**
 * "Only the piece that changed" is the claim the whole framework rests on, and a reader has no way to
 * test it. This demo counts.
 *
 * Each row owns a value and a counter of how many times a binding that reads that value has re-run.
 * The counters are wired the same way the template's own text bindings are — an `effect` that reads
 * one signal — so they are not a story about the update, they ARE an update, counted. Press a row's
 * button and its number moves while the other two sit still.
 *
 * `untrack` around the write matters: without it the effect would read the counter it writes and
 * subscribe to itself. That is a real mistake a reader can make, so the Reactivity page names it.
 */
interface Row {
  label: string;
  value: Signal<number>;
  /** How many times a binding subscribed to `value` has re-run. `reset` writes it, so it is a Signal. */
  writes: Signal<number>;
  bump: () => void;
}

function row(label: string, start: number): Row {
  const value = signal(start);
  const writes = signal(0);
  effect(() => {
    value(); // the only subscription — exactly what a `{{ value() }}` slot subscribes to
    untrack(() => writes.set((n) => n + 1));
  });
  return {
    label,
    value,
    writes,
    bump: (): void => {
      value.set((n) => n + 1);
    },
  };
}

export function setup() {
  const rows = [row('Apples', 3), row('Pears', 8), row('Plums', 1)];
  const total = computed((): number => rows.reduce((n, r) => n + r.value(), 0));
  const totalWrites = computed((): number => rows.reduce((n, r) => n + r.writes(), 0));
  const reset = (): void => {
    for (const r of rows) untrack(() => r.writes.set(0));
  };
}
