import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  computed,
  effect,
  enableDevtools,
  inspect,
  devNodeCount,
  onDevtoolsChange,
  createOwner,
  runInOwner,
  disposeOwner,
  type Owner,
  type Signal,
  type Computed,
  type DevSnapshot,
} from '@weave-framework/runtime';

const byName = (name: string): DevSnapshot | undefined => inspect().find((n) => n.name === name);

test('devtools: off by default — a named node does not register', () => {
  signal(1, { name: 'dt-off' });
  assert.equal(byName('dt-off'), undefined, 'nothing registered while devtools are off');
});

test('devtools: enabled — signal/computed/effect surface with kind + live value', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(5, { name: 'dt-count' });
    const d: Computed<number> = computed(() => s() * 2, { name: 'dt-double' });
    d(); // realize the memo
    effect(() => void s(), { name: 'dt-log' });

    assert.equal(byName('dt-count')?.kind, 'signal');
    assert.equal(byName('dt-count')?.value, 5);
    assert.equal(byName('dt-double')?.kind, 'computed');
    assert.equal(byName('dt-double')?.value, 10);
    assert.equal(byName('dt-log')?.kind, 'effect');
    assert.equal('value' in (byName('dt-log') as DevSnapshot), false, 'an effect has no value');

    s.set(7);
    assert.equal(byName('dt-count')?.value, 7, 'signal value is live');
    assert.equal(byName('dt-double')?.value, 14, 'computed value is live');
  });
  disposeOwner(owner);
  assert.equal(byName('dt-count'), undefined, 'unregistered when the owner disposes (no leak)');
  assert.equal(byName('dt-double'), undefined);
  assert.equal(byName('dt-log'), undefined);
  enableDevtools(false);
});

test('devtools: onDevtoolsChange fires on register + unregister; unsubscribe stops it', () => {
  enableDevtools(true);
  let changes: number = 0;
  const off: () => void = onDevtoolsChange(() => changes++);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    signal(1, { name: 'dt-chg' });
  });
  assert.ok(changes >= 1, 'fired when a named node registered');
  const afterRegister: number = changes;
  disposeOwner(owner);
  assert.ok(changes > afterRegister, 'fired again when the node unregistered');
  const afterDispose: number = changes;
  off();
  const owner2: Owner = createOwner();
  runInOwner(owner2, () => void signal(2, { name: 'dt-chg2' }));
  assert.equal(changes, afterDispose, 'no more fires after unsubscribe');
  disposeOwner(owner2);
  enableDevtools(false);
});

test('devtools: an unnamed node never registers (even when enabled)', () => {
  enableDevtools(true);
  const before: number = devNodeCount();
  signal(1);
  computed(() => 2);
  assert.equal(devNodeCount(), before, 'unnamed nodes are skipped');
  enableDevtools(false);
});

test('devtools: a throwing computed reports the error rather than crashing inspect()', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    computed((): number => {
      throw new Error('boom');
    }, { name: 'dt-throws' });
    const row: DevSnapshot | undefined = byName('dt-throws');
    assert.ok(row, 'registered');
    assert.ok(row!.value instanceof Error, 'value is the caught error, inspect did not throw');
  });
  disposeOwner(owner);
  enableDevtools(false);
});
