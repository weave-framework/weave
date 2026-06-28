import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untrack, onCleanup } from '../src/reactive.js';

test('signal read/write', () => {
  const n = signal(1);
  assert.equal(n(), 1);
  n.set(2);
  assert.equal(n(), 2);
  n.set((v) => v + 10);
  assert.equal(n(), 12);
  assert.equal(n.peek(), 12);
});

test('computed derives and caches', () => {
  const a = signal(2);
  const b = signal(3);
  let runs = 0;
  const sum = computed(() => {
    runs++;
    return a() + b();
  });
  assert.equal(sum(), 5);
  assert.equal(sum(), 5); // cached, no recompute
  assert.equal(runs, 1);
  a.set(10);
  assert.equal(sum(), 13);
  assert.equal(runs, 2);
});

test('effect runs on create and on change', () => {
  const n = signal(0);
  const seen = [];
  effect(() => seen.push(n()));
  assert.deepEqual(seen, [0]);
  n.set(1);
  n.set(2);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('effect does not fire when value is equal', () => {
  const n = signal(1);
  let runs = 0;
  effect(() => { n(); runs++; });
  n.set(1);
  assert.equal(runs, 1);
});

test('diamond graph is glitch-free (no double compute)', () => {
  const a = signal(1);
  const b = computed(() => a() + 1);
  const c = computed(() => a() + 1);
  let effectRuns = 0;
  let sum;
  effect(() => { sum = b() + c(); effectRuns++; });
  assert.equal(sum, 4);
  assert.equal(effectRuns, 1);
  a.set(2);
  assert.equal(sum, 6);
  assert.equal(effectRuns, 2); // exactly once for the single update, not twice
});

test('deep chain recomputes lazily', () => {
  const a = signal(1);
  let cRuns = 0;
  const b = computed(() => a() * 2);
  const c = computed(() => { cRuns++; return b() + 1; });
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
  // writing a value that does not change b's output still must not crash;
  a.set(1);
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
});

test('unchanged memo blocks downstream recompute', () => {
  const a = signal(4);
  const even = computed(() => a() % 2 === 0);
  let runs = 0;
  const label = computed(() => { runs++; return even() ? 'even' : 'odd'; });
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(6); // still even → even() unchanged → label must NOT recompute
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(7); // now odd
  assert.equal(label(), 'odd');
  assert.equal(runs, 2);
});

test('batch coalesces effect runs', () => {
  const a = signal(1);
  const b = signal(2);
  let runs = 0;
  effect(() => { a(); b(); runs++; });
  assert.equal(runs, 1);
  batch(() => {
    a.set(10);
    b.set(20);
  });
  assert.equal(runs, 2); // one run for the whole batch, not two
});

test('untrack reads without subscribing', () => {
  const a = signal(1);
  const b = signal(1);
  let runs = 0;
  effect(() => { a(); untrack(() => b()); runs++; });
  assert.equal(runs, 1);
  b.set(99); // not a dependency
  assert.equal(runs, 1);
  a.set(2);
  assert.equal(runs, 2);
});

test('effect cleanup runs before re-run and on dispose', () => {
  const n = signal(0);
  const log = [];
  const stop = effect(() => {
    const v = n();
    log.push(`run:${v}`);
    onCleanup(() => log.push(`cleanup:${v}`));
  });
  n.set(1);
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1']);
  stop();
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
  n.set(2); // disposed → nothing more
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
});

test('returned cleanup function works too', () => {
  const n = signal(0);
  const log = [];
  effect(() => {
    const v = n();
    return () => log.push(`tear:${v}`);
  });
  n.set(1);
  assert.deepEqual(log, ['tear:0']);
});

test('dynamic dependencies: stale sources are dropped', () => {
  const cond = signal(true);
  const a = signal('A');
  const b = signal('B');
  let out;
  let runs = 0;
  effect(() => { out = cond() ? a() : b(); runs++; });
  assert.equal(out, 'A');
  assert.equal(runs, 1);
  b.set('B2'); // b not currently a dependency
  assert.equal(runs, 1);
  cond.set(false);
  assert.equal(out, 'B2');
  assert.equal(runs, 2);
  a.set('A2'); // a no longer a dependency
  assert.equal(runs, 2);
});
