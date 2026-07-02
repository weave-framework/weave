/**
 * Virtual Scroll — the headless rendered-window engine under large Table/Tree bodies and
 * long lists. Given a scroll viewport + a fixed row height + a total count, it computes the
 * slice of items to actually render (a buffered window around the visible range) plus the
 * top/bottom spacer sizes that keep the scrollbar honest — all as signals. The consumer
 * renders only `items.slice(renderedRange().start, renderedRange().end)`, pads the top with
 * `scrollOffset()` px and the bottom with `endOffset()` px, and the native scrollbar behaves
 * as if the whole list were present.
 *
 * Fixed-size strategy first (`itemSize`); an autosize/variable-height strategy is a follow-on.
 * Built on the U1 `onScroll` dispatcher + `resizeSignal` (viewport height). Zero styling, zero-dep.
 *
 *   const vs = virtualScroll({ itemSize: 32, total: () => rows().length, viewport: () => elRef() });
 *   effect(() => { const { start, end } = vs.renderedRange(); render(rows().slice(start, end)); });
 *   // spacer top = vs.scrollOffset(), spacer bottom = vs.endOffset(), scroller height = vs.totalSize()
 */

import { signal, computed, effect, onDispose, type Signal, type Computed } from '@weave-framework/runtime';
import { onScroll } from './scroll.js';
import { resizeSignal, type Size } from './observers.js';

/** The rendered item index range, `[start, end)` (end exclusive). */
export interface RenderedRange {
  start: number;
  end: number;
}

export interface VirtualScrollOptions {
  /** Fixed row height in px (the fixed-size strategy). */
  itemSize: number;
  /** Total number of items — a number, or a getter for a reactive count. */
  total: number | (() => number);
  /** The scroll viewport element, or a getter (so a ref set after render is picked up). */
  viewport: HTMLElement | (() => HTMLElement | null);
  /** Rows rendered above + below the visible window (overscan). Default 4. */
  buffer?: number;
}

export interface VirtualScroller {
  /** The item index range to render, `[start, end)`. Reactive; only changes when the window does. */
  renderedRange(): RenderedRange;
  /** Top spacer height in px — the offset of the first rendered item. Reactive. */
  scrollOffset(): number;
  /** Bottom spacer height in px — space below the last rendered item. Reactive. */
  endOffset(): number;
  /** Total scrollable height in px (`itemSize * total`). Reactive. */
  totalSize(): number;
  /** Scroll the viewport so `index` sits at the top (clamped to range). */
  scrollToIndex(index: number): void;
  /** Force a resync of scroll position + viewport height (after a manual layout change). */
  measure(): void;
  /** Tear down listeners (also runs automatically on owner disposal). */
  destroy(): void;
}

/** Create a virtual-scroll engine over a fixed-height list. */
export function virtualScroll(options: VirtualScrollOptions): VirtualScroller {
  const itemSize: number = options.itemSize;
  const buffer: number = options.buffer ?? 4;
  const totalFn: () => number = typeof options.total === 'function' ? options.total : (): number => options.total as number;
  const getViewport: () => HTMLElement | null =
    typeof options.viewport === 'function' ? options.viewport : (): HTMLElement => options.viewport as HTMLElement;

  const scrollTop: Signal<number> = signal<number>(0);
  // Bumped when the viewport attaches, so `viewportHeight` re-pulls the (lazy) resize signal
  // into the reactive graph.
  const ready: Signal<number> = signal<number>(0);

  let el: HTMLElement | null = null;
  let size: (() => Size) | null = null;
  let unsub: (() => void) | null = null;

  const attach = (v: HTMLElement): void => {
    el = v;
    scrollTop.set(v.scrollTop);
    size = resizeSignal(v); // seeds from getBoundingClientRect, then ResizeObserver-driven
    unsub = onScroll(() => {
      if (el) scrollTop.set(el.scrollTop);
    });
    ready.set(ready.peek() + 1);
  };

  // Attach once, as soon as the viewport element is available (a ref may set it post-render).
  effect(() => {
    const v: HTMLElement | null = getViewport();
    if (v && !el) attach(v);
  });

  const viewportHeight = (): number => {
    ready();
    return size ? size().height : 0;
  };

  const renderedRange: Computed<RenderedRange> = computed(
    (): RenderedRange => {
      const n: number = Math.max(0, totalFn());
      if (n === 0) return { start: 0, end: 0 };
      const first: number = Math.max(0, Math.floor(scrollTop() / itemSize));
      const visible: number = Math.max(1, Math.ceil(viewportHeight() / itemSize));
      const start: number = Math.max(0, first - buffer);
      const end: number = Math.min(n, first + visible + buffer);
      return { start, end };
    },
    { equals: (a, b) => !!a && !!b && a.start === b.start && a.end === b.end },
  );

  const totalSize = (): number => Math.max(0, totalFn()) * itemSize;
  const scrollOffset = (): number => renderedRange().start * itemSize;
  const endOffset = (): number => totalSize() - renderedRange().end * itemSize;

  const destroy = (): void => {
    unsub?.();
    unsub = null;
  };
  onDispose(destroy);

  return {
    renderedRange: (): RenderedRange => renderedRange(),
    scrollOffset,
    endOffset,
    totalSize,
    scrollToIndex: (index: number): void => {
      const n: number = Math.max(0, totalFn());
      const clamped: number = Math.max(0, Math.min(index, n - 1));
      if (el) {
        el.scrollTop = clamped * itemSize;
        scrollTop.set(el.scrollTop);
      }
    },
    measure: (): void => {
      if (el) scrollTop.set(el.scrollTop);
      ready.set(ready.peek() + 1);
    },
    destroy,
  };
}
