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
  type ScrollStrategy,
  type OverlayRef,
} from '@weave-framework/ui/cdk';

function content(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  el.style.width = '40px';
  el.style.height = '20px';
  return el;
}
const scrollWin = (): void => {
  window.dispatchEvent(new Event('scroll'));
};

/* ─────────────────── dispatcher ─────────────────── */

test('onScroll: fires subscribers on a window scroll and unsubscribes', () => {
  let n: number = 0;
  const off: () => void = onScroll(() => n++);
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
  const s: ScrollStrategy = noopScroll();
  s.enable();
  s.disable();
  assert.ok(true);
});

test('blockScroll: locks body overflow on enable, restores on disable', () => {
  const prev: string = document.body.style.overflow;
  const s: ScrollStrategy = blockScroll();
  s.enable();
  assert.equal(document.body.style.overflow, 'hidden');
  s.disable();
  assert.equal(document.body.style.overflow, prev, 'prior overflow restored');
});

test('blockScroll: layered locks released OUT OF ORDER still restore the page exactly once', () => {
  // Each instance used to snapshot `body.style.overflow` at its own enable(). Open A (saves ''), open B
  // (saves 'hidden'), then close A FIRST — nothing forbids it, a programmatic `ref.close()` does exactly
  // that — and A restores '' while B is still open, so the page scrolls behind the modal. Closing B then
  // restores its snapshot 'hidden', and the page can never scroll again: no overlay is open, and only a
  // reload fixes it. The lock has to be counted, not per-instance.
  const prev: string = document.body.style.overflow;
  const a: ScrollStrategy = blockScroll();
  const b: ScrollStrategy = blockScroll();

  a.enable();
  b.enable();
  assert.equal(document.body.style.overflow, 'hidden', 'both locks held');

  a.disable(); // the OUTER one closes first
  assert.equal(document.body.style.overflow, 'hidden', 'still locked — B has not released yet');

  b.disable();
  assert.equal(document.body.style.overflow, prev, 'the last release restores the ORIGINAL value');
});

test('blockScroll: a double enable/disable on one instance does not unbalance the count', () => {
  const prev: string = document.body.style.overflow;
  const s: ScrollStrategy = blockScroll();
  s.enable();
  s.enable(); // idempotent — must not take a second reference
  s.disable();
  assert.equal(document.body.style.overflow, prev, 'one instance releases fully on one disable');
  s.disable(); // already released — must not underflow and re-lock a later overlay
  assert.equal(document.body.style.overflow, prev, 'a redundant disable is a no-op');
});

/* ─────────────────── wired into an overlay ─────────────────── */

test('closeScroll: detaches the overlay on scroll', () => {
  const ref: OverlayRef = createOverlay({ scrollStrategy: closeScroll });
  ref.attach(content());
  assert.equal(ref.attached(), true);
  scrollWin();
  assert.equal(ref.attached(), false, 'scroll closed the overlay');
  ref.dispose();
});

test('repositionScroll: re-applies the position strategy on scroll', () => {
  let applied: number = 0;
  const strategy: PositionStrategy = { apply: () => applied++ };
  const ref: OverlayRef = createOverlay({ positionStrategy: strategy, scrollStrategy: repositionScroll });
  ref.attach(content());
  assert.equal(applied, 1, 'applied on attach');
  scrollWin();
  assert.equal(applied, 2, 'repositioned on scroll');
  ref.dispose();
});

test('repositionScroll: detach disables it (no reposition after close)', () => {
  let applied: number = 0;
  const ref: OverlayRef = createOverlay({ positionStrategy: { apply: () => applied++ }, scrollStrategy: repositionScroll });
  ref.attach(content());
  ref.detach();
  const at: number = applied;
  scrollWin();
  assert.equal(applied, at, 'no reposition once detached');
  ref.dispose();
});

test('blockScroll: overlay enables on attach and restores on detach', () => {
  const prev: string = document.body.style.overflow;
  const ref: OverlayRef = createOverlay({ scrollStrategy: blockScroll });
  ref.attach(content());
  assert.equal(document.body.style.overflow, 'hidden', 'locked while open');
  ref.detach();
  assert.equal(document.body.style.overflow, prev, 'unlocked on detach');
  ref.dispose();
});

test('blockScroll: dispose also restores body scroll', () => {
  const prev: string = document.body.style.overflow;
  const ref: OverlayRef = createOverlay({ scrollStrategy: blockScroll });
  ref.attach(content());
  ref.dispose();
  assert.equal(document.body.style.overflow, prev, 'restored on dispose');
});

test('scroll strategy composes with connected positioning', () => {
  const origin: PositionOrigin = {
    getBoundingClientRect: () =>
      ({ x: 50, y: 50, left: 50, top: 50, right: 90, bottom: 70, width: 40, height: 20, toJSON: () => ({}) }) as DOMRect,
  };
  const ref: OverlayRef = createOverlay({
    positionStrategy: connectedPosition(origin, { positions: ['bottom-start'], autoUpdate: false }),
    scrollStrategy: closeScroll,
  });
  const panel: HTMLElement = ref.attach(content());
  assert.equal(parseInt(panel.style.top, 10), 70, 'positioned below origin');
  scrollWin();
  assert.equal(ref.attached(), false, 'closeScroll still fires alongside positioning');
  ref.dispose();
});
