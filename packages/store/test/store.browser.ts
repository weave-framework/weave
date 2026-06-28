import { test, assert } from '../../../tools/harness.js';
import { signal } from '@weave/runtime';
import { store } from '@weave/store';

test('store factory is lazy and runs exactly once', () => {
  let runs = 0;
  const useThing = store(() => {
    runs++;
    const n = signal(0);
    return { n, inc: () => n.set((x) => x + 1) };
  });
  assert.equal(runs, 0, 'factory not run until first use');

  const a = useThing();
  const b = useThing();
  assert.equal(runs, 1, 'factory runs once across calls');
  assert.is(a, b, 'same singleton instance returned');
});

test('store state is shared across callers (signals)', () => {
  const useCounter = store(() => {
    const n = signal(0);
    return { n, inc: () => n.set((x) => x + 1) };
  });
  const a = useCounter();
  const b = useCounter();
  a.inc();
  a.inc();
  assert.equal(b.n(), 2, 'mutating via one handle is visible through another');
});
