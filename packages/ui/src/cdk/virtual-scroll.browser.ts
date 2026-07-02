import { test, assert } from '../../../../tools/harness.js';
import { signal, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import { virtualScroll, type VirtualScroller, type VirtualScrollOptions, type RenderedRange } from '@weave-framework/ui/cdk';

const ITEM: number = 20;
const VIEW_H: number = 200; // → 10 fully-visible rows

interface Mounted {
  vp: HTMLElement;
  vs: VirtualScroller;
  owner: Owner;
  dispose: () => void;
}

function mount(opts: Partial<VirtualScrollOptions> & { total: VirtualScrollOptions['total'] }, height: number = VIEW_H): Mounted {
  const vp: HTMLElement = document.createElement('div');
  vp.style.cssText = `height:${height}px; overflow:auto`;
  const inner: HTMLElement = document.createElement('div');
  const totalN: number = typeof opts.total === 'function' ? opts.total() : opts.total;
  inner.style.height = `${totalN * ITEM}px`;
  vp.appendChild(inner);
  document.body.appendChild(vp);
  const owner: Owner = createOwner();
  const vs: VirtualScroller = runInOwner(owner, () =>
    virtualScroll({ itemSize: ITEM, viewport: vp, buffer: 0, ...opts }),
  );
  return {
    vp,
    vs,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      vp.remove();
    },
  };
}

/** Set the scroll position and notify the engine (its onScroll listener is on window/capture). */
function scrollTo(vp: HTMLElement, top: number): void {
  vp.scrollTop = top;
  vp.dispatchEvent(new Event('scroll'));
}
const raf2 = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/* ── window math ── */
test('virtual-scroll: at scroll 0 renders [0, visible) with no top offset', () => {
  const m: Mounted = mount({ total: 500 });
  assert.deepEqual(m.vs.renderedRange(), { start: 0, end: 10 });
  assert.equal(m.vs.scrollOffset(), 0);
  assert.equal(m.vs.totalSize(), 500 * ITEM);
  assert.equal(m.vs.endOffset(), 500 * ITEM - 10 * ITEM);
  m.dispose();
});

test('virtual-scroll: mid-scroll recenters the window + reports the offset', () => {
  const m: Mounted = mount({ total: 500 });
  scrollTo(m.vp, 1000); // first = 50
  assert.deepEqual(m.vs.renderedRange(), { start: 50, end: 60 });
  assert.equal(m.vs.scrollOffset(), 1000);
  m.dispose();
});

test('virtual-scroll: at the end the window clamps to total (endOffset 0, no overrun)', () => {
  const m: Mounted = mount({ total: 500 });
  scrollTo(m.vp, 500 * ITEM - VIEW_H); // 9800 → first = 490
  const r: RenderedRange = m.vs.renderedRange();
  assert.deepEqual(r, { start: 490, end: 500 });
  assert.equal(m.vs.endOffset(), 0, 'no bottom spacer at the end');
  m.dispose();
});

test('virtual-scroll: buffer overscans above + below the visible window', () => {
  const m: Mounted = mount({ total: 500, buffer: 4 });
  scrollTo(m.vp, 1000); // first = 50
  assert.deepEqual(m.vs.renderedRange(), { start: 46, end: 64 }, '50-4 .. 50+10+4');
  m.dispose();
});

test('virtual-scroll: buffer clamps at the top (no negative start)', () => {
  const m: Mounted = mount({ total: 500, buffer: 4 });
  assert.deepEqual(m.vs.renderedRange(), { start: 0, end: 14 }, 'start floored at 0');
  m.dispose();
});

/* ── edge cases ── */
test('virtual-scroll: empty list → { 0, 0 }, zero sizes (no negatives)', () => {
  const m: Mounted = mount({ total: 0 });
  assert.deepEqual(m.vs.renderedRange(), { start: 0, end: 0 });
  assert.equal(m.vs.totalSize(), 0);
  assert.equal(m.vs.scrollOffset(), 0);
  assert.equal(m.vs.endOffset(), 0);
  m.dispose();
});

test('virtual-scroll: short list (fewer than a viewport) renders all, no overrun', () => {
  const m: Mounted = mount({ total: 3 });
  assert.deepEqual(m.vs.renderedRange(), { start: 0, end: 3 });
  assert.equal(m.vs.endOffset(), 0);
  m.dispose();
});

/* ── reactivity ── */
test('virtual-scroll: a reactive total recomputes the window + total size', () => {
  const total: Signal<number> = signal<number>(500);
  const m: Mounted = mount({ total: () => total() });
  scrollTo(m.vp, 9000); // first = 450, end = min(500, 460) = 460
  assert.deepEqual(m.vs.renderedRange(), { start: 450, end: 460 });
  total.set(455); // list shrank under the current scroll → end clamps to 455
  assert.equal(m.vs.totalSize(), 455 * ITEM);
  assert.deepEqual(m.vs.renderedRange(), { start: 450, end: 455 });
  m.dispose();
});

test('virtual-scroll: renderedRange is stable across a sub-item scroll (equals guard)', () => {
  const m: Mounted = mount({ total: 500 });
  const r1: RenderedRange = m.vs.renderedRange();
  scrollTo(m.vp, 5); // still first index 0 → window unchanged
  const r2: RenderedRange = m.vs.renderedRange();
  assert.ok(r1 === r2, 'same object ref when the window did not change');
  m.dispose();
});

test('virtual-scroll: scrollToIndex positions the viewport + updates the window', () => {
  const m: Mounted = mount({ total: 500 });
  m.vs.scrollToIndex(100);
  assert.equal(m.vp.scrollTop, 100 * ITEM);
  assert.deepEqual(m.vs.renderedRange(), { start: 100, end: 110 });
  // out-of-range index clamps to the last item; the browser further clamps scrollTop to the
  // max scrollable (content − viewport), so it lands at the very end of the list.
  m.vs.scrollToIndex(9999);
  assert.equal(m.vp.scrollTop, 500 * ITEM - VIEW_H, 'scrolled as far as possible');
  assert.equal(m.vs.renderedRange().end, 500, 'last window reaches the end');
  m.dispose();
});

/* ── viewport resize (ResizeObserver → recompute) ── */
test('virtual-scroll: shrinking the viewport recomputes the visible count', async () => {
  const m: Mounted = mount({ total: 500 }); // 200px → 10 rows
  assert.equal(m.vs.renderedRange().end, 10);
  m.vp.style.height = '100px'; // → 5 rows
  await raf2(); // let ResizeObserver fire
  assert.equal(m.vs.renderedRange().end, 5, 'window shrank with the viewport');
  m.dispose();
});
