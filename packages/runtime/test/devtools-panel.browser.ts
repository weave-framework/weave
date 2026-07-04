import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  computed,
  enableDevtools,
  createOwner,
  runInOwner,
  disposeOwner,
  mountDevtoolsPanel,
  type Owner,
  type Signal,
  type Computed,
} from '@weave-framework/runtime';

const panelEl = (): HTMLElement | null => document.querySelector('[data-weave-devtools]');
const listText = (): string => document.querySelector('[data-weave-devtools-list]')?.textContent ?? '';

test('mountDevtoolsPanel lists nodes, updates live on value + registry change, disposes', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  let s: Signal<number> | null = null;
  runInOwner(owner, () => {
    s = signal(5, { name: 'panel-count' });
  });
  const dispose: () => void = mountDevtoolsPanel();
  assert.ok(panelEl(), 'panel mounted into the DOM');
  assert.ok(listText().includes('panel-count'), 'shows the registered node name');
  assert.ok(listText().includes('5'), 'shows its current value');

  // Value change: effects are synchronous, so the panel re-renders immediately (tracked read).
  s!.set(9);
  assert.ok(listText().includes('9'), 'value updates live');
  assert.ok(!listText().includes('= 5'), 'the old value is gone');

  // Registry change: a newly registered node shows up (via onDevtoolsChange → version signal).
  const owner2: Owner = createOwner();
  runInOwner(owner2, () => void signal('hi', { name: 'panel-msg' }));
  assert.ok(listText().includes('panel-msg'), 'a newly registered node appears');

  dispose();
  assert.equal(panelEl(), null, 'dispose removes the panel from the DOM');
  disposeOwner(owner);
  disposeOwner(owner2);
  enableDevtools(false);
});

test('mountDevtoolsPanel shows dependency edges (← source) for a computed', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    const s: Signal<number> = signal(3, { name: 'dep-src' });
    const d: Computed<number> = computed(() => s() * 2, { name: 'dep-double' });
    d(); // realize so the edge links
  });
  const dispose: () => void = mountDevtoolsPanel();
  assert.ok(listText().includes('dep-double'), 'computed is listed');
  assert.ok(listText().includes('← dep-src'), 'shows its dependency (who triggers it)');
  dispose();
  disposeOwner(owner);
  enableDevtools(false);
});

test('mountDevtoolsPanel filter narrows the list by name', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    signal(1, { name: 'alpha-node' });
    signal(2, { name: 'beta-node' });
  });
  const dispose: () => void = mountDevtoolsPanel();
  const input: HTMLInputElement = document.querySelector('[data-weave-devtools] input') as HTMLInputElement;
  input.value = 'alpha';
  input.dispatchEvent(new Event('input'));
  assert.ok(listText().includes('alpha-node'), 'matching node stays');
  assert.ok(!listText().includes('beta-node'), 'non-matching node is filtered out');
  dispose();
  disposeOwner(owner);
  enableDevtools(false);
});
