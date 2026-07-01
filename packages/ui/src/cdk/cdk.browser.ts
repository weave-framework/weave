import { test, assert } from '../../../../tools/harness.js';
import {
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  provide,
  type Owner,
} from '@weave-framework/runtime';
import {
  isBrowser,
  supportsPassive,
  rtl,
  hasHover,
  hasFinePointer,
  prefersReducedMotion,
  supportsPopover,
  direction,
  setDirection,
  activeDirection,
  DirectionContext,
  type Direction,
} from '@weave-framework/ui/cdk';

const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

/* ─────────────────────────── platform ─────────────────────────── */

test('platform: isBrowser is true under a real DOM', () => {
  assert.equal(isBrowser, true);
});

test('platform: capability probes return booleans (feature-detected)', () => {
  for (const v of [supportsPassive(), hasHover(), hasFinePointer(), prefersReducedMotion(), supportsPopover]) {
    assert.equal(typeof v, 'boolean');
  }
});

test('platform: supportsPassive memoizes (stable across calls)', () => {
  assert.equal(supportsPassive(), supportsPassive());
});

test('platform: rtl() reflects the live document direction', () => {
  const prev: string = document.documentElement.dir;
  document.documentElement.dir = 'rtl';
  assert.equal(rtl(), true);
  document.documentElement.dir = 'ltr';
  assert.equal(rtl(), false);
  document.documentElement.dir = prev;
});

/* ─────────────────────────── bidi ─────────────────────────── */

test('bidi: direction defaults to ltr and setDirection updates it', () => {
  assert.equal(direction(), 'ltr');
  setDirection('rtl');
  assert.equal(direction(), 'rtl');
  setDirection('ltr'); // restore global for other tests
});

test('bidi: direction() is reactive — an effect re-runs on change', async () => {
  const seen: Direction[] = [];
  const stop = effect(() => {
    seen.push(direction());
  });
  await tick();
  setDirection('rtl');
  await tick();
  setDirection('ltr');
  await tick();
  assert.ok(seen.includes('rtl') && seen[seen.length - 1] === 'ltr', 'effect saw the transitions');
  stop();
});

test('bidi: activeDirection falls back to the global when no context', () => {
  setDirection('rtl');
  assert.equal(activeDirection(), 'rtl', 'no owner → global direction');
  setDirection('ltr');
});

test('bidi: DirectionContext overrides the global within a subtree', () => {
  setDirection('ltr'); // global stays ltr
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    provide(DirectionContext, 'rtl');
    assert.equal(activeDirection(), 'rtl', 'context-provided direction wins');
  });
  disposeOwner(owner);
  assert.equal(activeDirection(), 'ltr', 'outside the subtree, back to global');
});
