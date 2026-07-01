import { test, assert } from '../../../../tools/harness.js';
import { createOverlay, connectedPosition, setDirection, type PositionOrigin } from '@weave-framework/ui/cdk';

const VW = (): number => window.innerWidth;
const VH = (): number => window.innerHeight;

/** A virtual origin whose rect is read live from `get` (deterministic, no layout). */
function virtualOrigin(get: () => { x: number; y: number; w: number; h: number }): PositionOrigin {
  return {
    getBoundingClientRect(): DOMRect {
      const { x, y, w, h } = get();
      return { x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) } as DOMRect;
    },
  };
}

function fixed(x: number, y: number, w: number, h: number): PositionOrigin {
  return virtualOrigin(() => ({ x, y, w, h }));
}

/** Content of a definite size so the panel measures deterministically. */
function sized(w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return el;
}

const px = (el: HTMLElement, prop: 'left' | 'top'): number => parseInt(el.style[prop] || '0', 10);

test('positioning: bottom-start places the panel below, left edges aligned', () => {
  const ref = createOverlay({ positionStrategy: connectedPosition(fixed(100, 100, 50, 20), { positions: ['bottom-start'] }) });
  const panel = ref.attach(sized(80, 40));
  assert.equal(px(panel, 'left'), 100, 'left aligned to origin.left');
  assert.equal(px(panel, 'top'), 120, 'top at origin.bottom');
  ref.dispose();
});

test('positioning: offset adds a gap along the connection axis', () => {
  const ref = createOverlay({ positionStrategy: connectedPosition(fixed(100, 100, 50, 20), { positions: ['bottom-start'], offset: 8 }) });
  const panel = ref.attach(sized(80, 40));
  assert.equal(px(panel, 'top'), 128, 'origin.bottom + 8');
  ref.dispose();
});

test('positioning: flips to top when the preferred bottom overflows', () => {
  const oy = VH() - 30; // origin near the bottom edge
  const strat = connectedPosition(fixed(100, oy, 50, 20), { positions: ['bottom-start', 'top-start'] });
  const ref = createOverlay({ positionStrategy: strat });
  const panel = ref.attach(sized(80, 100));
  // bottom-start would overflow → engine flips to top-start (panel above the origin top).
  assert.equal(px(panel, 'top'), oy - 100, 'panel sits above the origin (flipped)');
  assert.equal(strat.appliedPosition()!.overlayY, 'bottom', 'applied the top-start pairing');
  ref.dispose();
});

test('positioning: shifts (clamps) into view when a single position overflows the right edge', () => {
  const ox = VW() - 20; // origin hugging the right edge
  const ref = createOverlay({ positionStrategy: connectedPosition(fixed(ox, 100, 50, 20), { positions: ['bottom-start'], viewportMargin: 8 }) });
  const panel = ref.attach(sized(80, 40));
  assert.equal(px(panel, 'left'), VW() - 8 - 80, 'left clamped to keep the panel on-screen');
  ref.dispose();
});

test('positioning: RTL resolves start/end — bottom-start aligns right edges', () => {
  setDirection('rtl');
  try {
    const ref = createOverlay({ positionStrategy: connectedPosition(fixed(100, 100, 50, 20), { positions: ['bottom-start'] }) });
    const panel = ref.attach(sized(80, 40));
    // start = right in RTL: origin.right (150) minus full overlay width (80) = 70.
    assert.equal(px(panel, 'left'), 70, 'right edges aligned under RTL');
    assert.equal(px(panel, 'top'), 120);
    ref.dispose();
  } finally {
    setDirection('ltr');
  }
});

test('positioning: the "bottom" center preset centers horizontally on the origin', () => {
  const ref = createOverlay({ positionStrategy: connectedPosition(fixed(100, 100, 50, 20), { positions: ['bottom'] }) });
  const panel = ref.attach(sized(80, 40));
  // origin center = 125; panel center aligns → left = 125 - 40 = 85.
  assert.equal(px(panel, 'left'), 85);
  ref.dispose();
});

test('positioning: an explicit ConnectedPosition pair works (escape hatch)', () => {
  const ref = createOverlay({
    positionStrategy: connectedPosition(fixed(100, 100, 50, 20), {
      positions: [{ originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetX: 4 }],
    }),
  });
  const panel = ref.attach(sized(80, 40));
  // origin.right (150) + offsetX 4, overlay left edge → left = 154.
  assert.equal(px(panel, 'left'), 154);
  assert.equal(px(panel, 'top'), 120);
  ref.dispose();
});

test('positioning: autoUpdate repositions on scroll', () => {
  let oy = 100;
  const strat = connectedPosition(virtualOrigin(() => ({ x: 100, y: oy, w: 50, h: 20 })), { positions: ['bottom-start'] });
  const ref = createOverlay({ positionStrategy: strat });
  const panel = ref.attach(sized(80, 40));
  assert.equal(px(panel, 'top'), 120, 'initial');
  oy = 200; // origin moved (as if the page scrolled)
  window.dispatchEvent(new Event('scroll'));
  assert.equal(px(panel, 'top'), 220, 'repositioned to the new origin');
  ref.dispose();
});

test('positioning: dispose stops repositioning', () => {
  let oy = 100;
  const strat = connectedPosition(virtualOrigin(() => ({ x: 100, y: oy, w: 50, h: 20 })), { positions: ['bottom-start'] });
  const ref = createOverlay({ positionStrategy: strat });
  const panel = ref.attach(sized(80, 40));
  ref.dispose();
  oy = 300;
  window.dispatchEvent(new Event('scroll'));
  assert.notEqual(px(panel, 'top'), 320, 'no reposition after dispose');
});
