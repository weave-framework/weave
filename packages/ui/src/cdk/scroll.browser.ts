import { test, assert } from '../../../../tools/harness.js';
import {
  onScroll,
  noopScroll,
  repositionScroll,
  closeScroll,
  blockScroll,
  createOverlay,
  connectedPosition,
  type PositionStrategy,
  type PositionOrigin,
} from '@weave-framework/ui/cdk';

function content(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '40px';
  el.style.height = '20px';
  return el;
}
const scrollWin = (): void => {
  window.dispatchEvent(new Event('scroll'));
};

/* ─────────────────── dispatcher ─────────────────── */

test('onScroll: fires subscribers on a window scroll and unsubscribes', () => {
  let n = 0;
  const off = onScroll(() => n++);
  scrollWin();
  assert.equal(n, 1);
  scrollWin();
  assert.equal(n, 2);
  off();
  scrollWin();
  assert.equal(n, 2, 'no longer called after unsubscribe');
});

/* ─────────────────── strategies standalone ─────────────────── */

test('noopScroll: enable/disable are inert', () => {
  const s = noopScroll();
  s.enable();
  s.disable();
  assert.ok(true);
});

test('blockScroll: locks body overflow on enable, restores on disable', () => {
  const prev = document.body.style.overflow;
  const s = blockScroll();
  s.enable();
  assert.equal(document.body.style.overflow, 'hidden');
  s.disable();
  assert.equal(document.body.style.overflow, prev, 'prior overflow restored');
});

/* ─────────────────── wired into an overlay ─────────────────── */

test('closeScroll: detaches the overlay on scroll', () => {
  const ref = createOverlay({ scrollStrategy: closeScroll });
  ref.attach(content());
  assert.equal(ref.attached(), true);
  scrollWin();
  assert.equal(ref.attached(), false, 'scroll closed the overlay');
  ref.dispose();
});

test('repositionScroll: re-applies the position strategy on scroll', () => {
  let applied = 0;
  const strategy: PositionStrategy = { apply: () => applied++ };
  const ref = createOverlay({ positionStrategy: strategy, scrollStrategy: repositionScroll });
  ref.attach(content());
  assert.equal(applied, 1, 'applied on attach');
  scrollWin();
  assert.equal(applied, 2, 'repositioned on scroll');
  ref.dispose();
});

test('repositionScroll: detach disables it (no reposition after close)', () => {
  let applied = 0;
  const ref = createOverlay({ positionStrategy: { apply: () => applied++ }, scrollStrategy: repositionScroll });
  ref.attach(content());
  ref.detach();
  const at = applied;
  scrollWin();
  assert.equal(applied, at, 'no reposition once detached');
  ref.dispose();
});

test('blockScroll: overlay enables on attach and restores on detach', () => {
  const prev = document.body.style.overflow;
  const ref = createOverlay({ scrollStrategy: blockScroll });
  ref.attach(content());
  assert.equal(document.body.style.overflow, 'hidden', 'locked while open');
  ref.detach();
  assert.equal(document.body.style.overflow, prev, 'unlocked on detach');
  ref.dispose();
});

test('blockScroll: dispose also restores body scroll', () => {
  const prev = document.body.style.overflow;
  const ref = createOverlay({ scrollStrategy: blockScroll });
  ref.attach(content());
  ref.dispose();
  assert.equal(document.body.style.overflow, prev, 'restored on dispose');
});

test('scroll strategy composes with connected positioning', () => {
  const origin: PositionOrigin = {
    getBoundingClientRect: () =>
      ({ x: 50, y: 50, left: 50, top: 50, right: 90, bottom: 70, width: 40, height: 20, toJSON: () => ({}) }) as DOMRect,
  };
  const ref = createOverlay({
    positionStrategy: connectedPosition(origin, { positions: ['bottom-start'], autoUpdate: false }),
    scrollStrategy: closeScroll,
  });
  const panel = ref.attach(content());
  assert.equal(parseInt(panel.style.top, 10), 70, 'positioned below origin');
  scrollWin();
  assert.equal(ref.attached(), false, 'closeScroll still fires alongside positioning');
  ref.dispose();
});
