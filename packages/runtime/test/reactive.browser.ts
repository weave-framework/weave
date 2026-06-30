import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, batch, untrack, onCleanup, onMount, tick, root } from '@weave-framework/runtime';
import type { Signal, Computed } from '@weave-framework/runtime';

test('signal read/write', () => {
  const n: Signal<number> = signal(1);
  assert.equal(n(), 1);
  n.set(2);
  assert.equal(n(), 2);
  n.set((v) => v + 10);
  assert.equal(n(), 12);
  assert.equal(n.peek(), 12);
});

test('computed derives and caches', () => {
  const a: Signal<number> = signal(2);
  const b: Signal<number> = signal(3);
  let runs: number = 0;
  const sum: Computed<number> = computed(() => {
    runs++;
    return a() + b();
  });
  assert.equal(sum(), 5);
  assert.equal(sum(), 5);
  assert.equal(runs, 1);
  a.set(10);
  assert.equal(sum(), 13);
  assert.equal(runs, 2);
});

test('effect runs on create and on change', () => {
  const n: Signal<number> = signal(0);
  const seen: number[] = [];
  effect(() => seen.push(n()));
  assert.deepEqual(seen, [0]);
  n.set(1);
  n.set(2);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('effect does not fire when value is equal', () => {
  const n: Signal<number> = signal(1);
  let runs: number = 0;
  effect(() => {
    n();
    runs++;
  });
  n.set(1);
  assert.equal(runs, 1);
});

test('diamond graph is glitch-free (no double compute)', () => {
  const a: Signal<number> = signal(1);
  const b: Computed<number> = computed(() => a() + 1);
  const c: Computed<number> = computed(() => a() + 1);
  let effectRuns: number = 0;
  let sum: number = 0;
  effect(() => {
    sum = b() + c();
    effectRuns++;
  });
  assert.equal(sum, 4);
  assert.equal(effectRuns, 1);
  a.set(2);
  assert.equal(sum, 6);
  assert.equal(effectRuns, 2);
});

test('deep chain recomputes lazily', () => {
  const a: Signal<number> = signal(1);
  let cRuns: number = 0;
  const b: Computed<number> = computed(() => a() * 2);
  const c: Computed<number> = computed(() => {
    cRuns++;
    return b() + 1;
  });
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
  a.set(1);
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
});

test('unchanged memo blocks downstream recompute', () => {
  const a: Signal<number> = signal(4);
  const even: Computed<boolean> = computed(() => a() % 2 === 0);
  let runs: number = 0;
  const label: Computed<string> = computed(() => {
    runs++;
    return even() ? 'even' : 'odd';
  });
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(6);
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(7);
  assert.equal(label(), 'odd');
  assert.equal(runs, 2);
});

test('batch coalesces effect runs', () => {
  const a: Signal<number> = signal(1);
  const b: Signal<number> = signal(2);
  let runs: number = 0;
  effect(() => {
    a();
    b();
    runs++;
  });
  assert.equal(runs, 1);
  batch(() => {
    a.set(10);
    b.set(20);
  });
  assert.equal(runs, 2);
});

test('untrack reads without subscribing', () => {
  const a: Signal<number> = signal(1);
  const b: Signal<number> = signal(1);
  let runs: number = 0;
  effect(() => {
    a();
    untrack(() => b());
    runs++;
  });
  assert.equal(runs, 1);
  b.set(99);
  assert.equal(runs, 1);
  a.set(2);
  assert.equal(runs, 2);
});

test('effect cleanup runs before re-run and on dispose', () => {
  const n: Signal<number> = signal(0);
  const log: string[] = [];
  const stop: () => void = effect(() => {
    const v: number = n();
    log.push(`run:${v}`);
    onCleanup(() => log.push(`cleanup:${v}`));
  });
  n.set(1);
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1']);
  stop();
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
  n.set(2);
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
});

test('returned cleanup function works too', () => {
  const n: Signal<number> = signal(0);
  const log: string[] = [];
  effect(() => {
    const v: number = n();
    return () => log.push(`tear:${v}`);
  });
  n.set(1);
  assert.deepEqual(log, ['tear:0']);
});

test('dynamic dependencies: stale sources are dropped', () => {
  const cond: Signal<boolean> = signal(true);
  const a: Signal<string> = signal('A');
  const b: Signal<string> = signal('B');
  let out: string = '';
  let runs: number = 0;
  effect(() => {
    out = cond() ? a() : b();
    runs++;
  });
  assert.equal(out, 'A');
  assert.equal(runs, 1);
  b.set('B2');
  assert.equal(runs, 1);
  cond.set(false);
  assert.equal(out, 'B2');
  assert.equal(runs, 2);
  a.set('A2');
  assert.equal(runs, 2);
});

/* ──────────── tick ──────────── */

test('tick resolves on a microtask (after earlier-queued microtasks)', async () => {
  const order: string[] = [];
  queueMicrotask(() => order.push('earlier'));
  await tick();
  order.push('after-tick');
  assert.deepEqual(order, ['earlier', 'after-tick']);
});

test('await tick flushes a pending onMount callback', async () => {
  let mounted: boolean = false;
  root((d) => {
    onMount(() => {
      mounted = true;
    });
    return d;
  });
  assert.equal(mounted, false, 'onMount is deferred, not synchronous');
  await tick();
  assert.equal(mounted, true, 'onMount ran before tick resolved');
});

test('synchronous reactive updates are already applied before tick', async () => {
  const n: Signal<number> = signal(0);
  let seen: number = -1;
  effect(() => {
    seen = n();
  });
  n.set(3);
  assert.equal(seen, 3, 'effect already ran synchronously on set');
  await tick(); // nothing pending — still resolves
  assert.equal(seen, 3);
});
