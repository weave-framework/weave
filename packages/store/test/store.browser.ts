import { test, assert } from '../../../tools/harness.js';
import { signal } from '@weave/runtime';
import type { Signal } from '@weave/runtime';
import { store } from '@weave/store';

interface Counter {
  n: Signal<number>;
  inc: () => number;
}

test('store factory is lazy and runs exactly once', () => {
  let runs: number = 0;
  const useThing: () => Counter = store(() => {
    runs++;
    const n: Signal<number> = signal(0);
    return { n, inc: (): number => n.set((x) => x + 1) };
  });
  assert.equal(runs, 0, 'factory not run until first use');

  const a: Counter = useThing();
  const b: Counter = useThing();
  assert.equal(runs, 1, 'factory runs once across calls');
  assert.is(a, b, 'same singleton instance returned');
});

test('store state is shared across callers (signals)', () => {
  const useCounter: () => Counter = store(() => {
    const n: Signal<number> = signal(0);
    return { n, inc: (): number => n.set((x) => x + 1) };
  });
  const a: Counter = useCounter();
  const b: Counter = useCounter();
  a.inc();
  a.inc();
  assert.equal(b.n(), 2, 'mutating via one handle is visible through another');
});
