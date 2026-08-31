import { signal, effect, batch, untrack } from '@weave-framework/runtime';

/**
 * `batch` is a claim about a number nobody can see: how many times the effect ran. So the demo counts.
 *
 * The two buttons write the SAME three values. Without `batch` each `.set` flushes, so the effect runs
 * three times and the intermediate states are real — the middle column shows every position it passed
 * through. With `batch` it runs once, and those intermediates never existed for anyone downstream.
 *
 * The trail is the part worth seeing. "Runs three times instead of once" sounds like a performance
 * detail; "an observer saw x=10 while y was still 0" is a correctness one, and that is the state a
 * half-applied update actually is.
 */
export function setup() {
  const x = signal(0);
  const y = signal(0);
  const label = signal('start');

  const runs = signal(0);
  const trail = signal<string[]>([]);

  effect(() => {
    const seen = `${label()}: (${x()}, ${y()})`;
    untrack(() => {
      runs.set((r) => r + 1);
      trail.set((t) => [...t.slice(-5), seen]);
    });
  });

  const writeLoose = (): void => {
    label.set('loose');
    x.set((v) => v + 10);
    y.set((v) => v + 20);
  };

  const writeBatched = (): void => {
    batch(() => {
      label.set('batched');
      x.set((v) => v + 10);
      y.set((v) => v + 20);
    });
  };

  const reset = (): void => {
    batch(() => {
      x.set(0);
      y.set(0);
      label.set('start');
    });
    untrack(() => {
      runs.set(0);
      trail.set([]);
    });
  };
}
