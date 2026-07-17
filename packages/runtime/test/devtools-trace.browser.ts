import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  computed,
  effect,
  enableDevtools,
  inspect,
  inspectTrace,
  traceFor,
  clearTrace,
  setTraceLimit,
  createOwner,
  runInOwner,
  disposeOwner,
  type Owner,
  type Signal,
  type Computed,
  type DevTrigger,
} from '@weave-framework/runtime';

const idOf = (name: string): number => inspect().find((n) => n.name === name)!.id;

test('trace: a signal write records a from→to edge to the computed it dirties', () => {
  enableDevtools(true);
  clearTrace();
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(1, { name: 'tr-src' });
    const d: Computed<number> = computed(() => s() * 2, { name: 'tr-double' });
    d(); // realize + subscribe the memo to the signal
    s.set(2);
    const evs: DevTrigger[] = inspectTrace();
    assert.ok(
      evs.some((e) => e.fromName === 'tr-src' && e.toName === 'tr-double'),
      'recorded tr-src → tr-double on the write'
    );
    assert.equal(evs[0].fromName, 'tr-src', 'newest event first');
  });
  disposeOwner(owner);
  enableDevtools(false);
});

test('trace: a signal write records the edge to an effect it dirties', () => {
  enableDevtools(true);
  clearTrace();
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(0, { name: 'tr-s2' });
    effect(() => void s(), { name: 'tr-eff' });
    s.set(1);
    assert.ok(
      inspectTrace().some((e) => e.fromName === 'tr-s2' && e.toName === 'tr-eff'),
      'signal → effect edge recorded'
    );
  });
  disposeOwner(owner);
  enableDevtools(false);
});

test('trace: a chain A→B→C records both hops (memo value change propagates)', () => {
  enableDevtools(true);
  clearTrace();
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const a: Signal<number> = signal(1, { name: 'ch-a' });
    const b: Computed<number> = computed(() => a() + 1, { name: 'ch-b' });
    const c: Computed<number> = computed(() => b() + 1, { name: 'ch-c' });
    effect(() => void c(), { name: 'ch-eff' }); // keeps c realized + pulled
    a.set(5);
    const evs: DevTrigger[] = inspectTrace();
    assert.ok(evs.some((e) => e.fromName === 'ch-a' && e.toName === 'ch-b'), 'A→B recorded on the write');
    assert.ok(evs.some((e) => e.fromName === 'ch-b' && e.toName === 'ch-c'), 'B→C recorded when B recomputes');
  });
  disposeOwner(owner);
  enableDevtools(false);
});

test('traceFor: filters events to those touching one node', () => {
  enableDevtools(true);
  clearTrace();
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(1, { name: 'tf-src' });
    const d: Computed<number> = computed(() => s() * 2, { name: 'tf-d' });
    const other: Signal<number> = signal(1, { name: 'tf-other' });
    const od: Computed<number> = computed(() => other() * 2, { name: 'tf-od' });
    d();
    od();
    s.set(9);
    other.set(9);
    const srcId: number = idOf('tf-src');
    const slice: DevTrigger[] = traceFor(srcId);
    assert.ok(slice.length >= 1, 'has events for tf-src');
    assert.ok(
      slice.every((e) => e.from === srcId || e.to === srcId),
      'every event in the slice touches tf-src'
    );
    assert.ok(!slice.some((e) => e.fromName === 'tf-other'), 'unrelated events excluded');
  });
  disposeOwner(owner);
  enableDevtools(false);
});

test('trace: records nothing while devtools are off (zero-cost)', () => {
  enableDevtools(false);
  clearTrace();
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(1, { name: 'off-src' });
    const d: Computed<number> = computed(() => s() * 2, { name: 'off-d' });
    d();
    s.set(2);
  });
  disposeOwner(owner);
  assert.equal(inspectTrace().length, 0, 'no events recorded when off');
});

test('trace: the ring-buffer caps at setTraceLimit, dropping oldest', () => {
  enableDevtools(true);
  clearTrace();
  setTraceLimit(3);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(0, { name: 'cap-src' });
    const d: Computed<number> = computed(() => s(), { name: 'cap-d' });
    effect(() => void d(), { name: 'cap-eff' }); // pull d each change so both hops record
    for (let i: number = 1; i <= 10; i++) s.set(i);
    assert.ok(inspectTrace().length <= 3, 'buffer never exceeds the cap');
  });
  disposeOwner(owner);
  setTraceLimit(500); // restore default
  clearTrace();
  enableDevtools(false);
});
