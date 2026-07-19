import { test, assert } from '../../../tools/harness.js';
import { signal, effect, root } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';
import { store } from '@weave-framework/store';

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

test('a store outlives the component that happened to use it first', () => {
  // A store is an app-lifetime singleton, but the factory used to run under whatever owner was ambient at
  // the FIRST call — i.e. the first consuming component. Every reactive primitive created inside it
  // registered its disposer there, so unmounting that one component permanently killed the store's own
  // effects while every other consumer kept the same (now half-dead) instance. Order-dependent and silent:
  // the signals still work, so the store looks alive. `optimistic()` uses `watch` internally, which makes a
  // store-created optimistic exactly this case — its overlay would never clear again.
  const source: Signal<number> = signal(0);
  let fired: number = 0;
  const useThing: () => { source: Signal<number> } = store(() => {
    effect(() => {
      source();
      fired++;
    });
    return { source };
  });

  let disposeFirstConsumer: (() => void) | undefined;
  root((dispose: () => void) => {
    disposeFirstConsumer = dispose; // stand-in for the first component's owner
    useThing();
  });
  const afterCreate: number = fired;
  assert.ok(afterCreate > 0, 'the store effect ran once on creation');

  disposeFirstConsumer!(); // that component unmounts; the store must not go with it
  source.set(1);
  assert.ok(fired > afterCreate, 'the store effect still runs after the first consumer is disposed');
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
