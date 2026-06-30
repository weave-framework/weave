import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  createOwner,
  runInOwner,
  disposeOwner,
  linkedSignal,
  debounced,
  watch,
} from '@weave-framework/runtime';
import type { Signal, Computed, Owner } from '@weave-framework/runtime';

const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/* ──────────────────────────── linkedSignal ──────────────────────────── */

test('linkedSignal seeds from the source and is writable', () => {
  const items: Signal<number[]> = signal([10, 20, 30]);
  const owner: Owner = createOwner();
  const sel: Signal<number> = runInOwner(owner, () => linkedSignal(() => items()[0]));
  assert.equal(sel(), 10, 'seeded from the source');

  sel.set(20);
  assert.equal(sel(), 20, 'local override sticks');
  disposeOwner(owner);
});

test('linkedSignal resets when the source changes (overriding a local edit)', () => {
  const items: Signal<number[]> = signal([10, 20, 30]);
  const owner: Owner = createOwner();
  const sel: Signal<number> = runInOwner(owner, () => linkedSignal(() => items()[0]));

  sel.set(99); // local override
  assert.equal(sel(), 99);

  items.set([7, 8, 9]); // source changes → reset
  assert.equal(sel(), 7, 'reset to the fresh source value');
  disposeOwner(owner);
});

test('linkedSignal stops resetting after its owner is disposed', () => {
  const src: Signal<number> = signal(1);
  const owner: Owner = createOwner();
  const v: Signal<number> = runInOwner(owner, () => linkedSignal(() => src()));
  assert.equal(v(), 1);

  disposeOwner(owner);
  src.set(2);
  assert.equal(v(), 1, 'no reset after dispose — the internal effect is gone');
});

/* ──────────────────────────── debounced ──────────────────────────── */

test('debounced seeds immediately and trails the source', async () => {
  const q: Signal<string> = signal('a');
  const owner: Owner = createOwner();
  const dq: Computed<string> = runInOwner(owner, () => debounced(() => q(), 30));
  assert.equal(dq(), 'a', 'initial value is immediate (no delay)');

  q.set('ab');
  assert.equal(dq(), 'a', 'still the old value right after the change');
  await wait(50);
  assert.equal(dq(), 'ab', 'updates after the quiet window');
  disposeOwner(owner);
});

test('debounced collapses rapid changes — only the last value lands', async () => {
  const q: Signal<string> = signal('');
  const owner: Owner = createOwner();
  const dq: Computed<string> = runInOwner(owner, () => debounced(() => q(), 30));

  q.set('a');
  await wait(10);
  q.set('ab'); // restarts the timer
  await wait(10);
  q.set('abc'); // restarts again
  assert.equal(dq(), '', 'nothing committed while changes keep coming');
  await wait(50);
  assert.equal(dq(), 'abc', 'only the final value is applied');
  disposeOwner(owner);
});

test('debounced cancels a pending write on dispose', async () => {
  const q: Signal<string> = signal('x');
  const owner: Owner = createOwner();
  const dq: Computed<string> = runInOwner(owner, () => debounced(() => q(), 30));

  q.set('y');
  disposeOwner(owner); // unmount before the timer fires
  await wait(50);
  assert.equal(dq(), 'x', 'the pending update was cancelled');
});

/* ──────────────────────────── watch ──────────────────────────── */

test('watch fires on change with (value, prev), not on init', () => {
  const n: Signal<number> = signal(0);
  const seen: Array<[number, number | undefined]> = [];
  const owner: Owner = createOwner();
  runInOwner(owner, () => watch(() => n(), (v, p) => seen.push([v, p])));

  assert.deepEqual(seen, [], 'lazy by default — no initial call');
  n.set(1);
  n.set(2);
  assert.deepEqual(seen, [[1, 0], [2, 1]], 'fires with new + previous value');
  disposeOwner(owner);
});

test('watch immediate fires on creation with prev undefined', () => {
  const n: Signal<number> = signal(5);
  const seen: Array<[number, number | undefined]> = [];
  const owner: Owner = createOwner();
  runInOwner(owner, () => watch(() => n(), (v, p) => seen.push([v, p]), { immediate: true }));

  assert.deepEqual(seen, [[5, undefined]], 'fires immediately with no previous');
  n.set(6);
  assert.deepEqual(seen, [[5, undefined], [6, 5]]);
  disposeOwner(owner);
});

test('watch tracks only the source — the callback\'s reads do not subscribe', () => {
  const src: Signal<number> = signal(0);
  const other: Signal<number> = signal(100);
  let runs: number = 0;
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    watch(
      () => src(),
      () => {
        other(); // reading this must NOT make watch re-run
        runs++;
      }
    )
  );

  src.set(1);
  assert.equal(runs, 1);
  other.set(200); // unrelated — watch should ignore it
  assert.equal(runs, 1, 'callback reads are untracked');
  disposeOwner(owner);
});

test('watch callback cleanup runs before the next call and on stop', () => {
  const n: Signal<number> = signal(0);
  const cleaned: number[] = [];
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    watch(() => n(), (v) => () => cleaned.push(v))
  );

  n.set(1); // first cb runs, registers cleanup for v=1
  n.set(2); // cleanup(1) fires, cb runs, registers cleanup for v=2
  assert.deepEqual(cleaned, [1], 'previous cleanup ran before the next call');
  disposeOwner(owner);
  assert.deepEqual(cleaned, [1, 2], 'final cleanup ran on stop');
});
