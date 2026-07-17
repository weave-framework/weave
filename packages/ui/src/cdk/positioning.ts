/**
 * Connected positioning — the in-house "floating" engine (our @floating-ui / Material
 * `FlexibleConnectedPositionStrategy`, zero-dep). Anchors an overlay panel to an origin
 * element via a list of preferred connected positions, then:
 *   • picks the first preferred position that fully fits the viewport,
 *   • **flips** to a fallback when the preferred one overflows,
 *   • **shifts** (clamps) along the axes to keep the panel on-screen if none fit,
 *   • reports the position it actually applied (for arrow placement / transform-origin),
 *   • repositions on scroll/resize while attached.
 *
 * Pure geometry against `getBoundingClientRect` + the viewport. RTL-aware: `start`/`end`
 * resolve through `activeDirection()`. Plugs into the overlay as a `PositionStrategy`.
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { activeDirection } from './bidi.js';
import { isBrowser } from './platform.js';
import type { PositionStrategy } from './overlay.js';

type H = 'start' | 'center' | 'end';
type V = 'top' | 'center' | 'bottom';

/** A named preset. `-start`/`-end` follow text direction (RTL-aware). */
export type PositionName =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end';

/** An explicit origin↔overlay anchor pairing (the escape hatch under the presets). */
export interface ConnectedPosition {
  originX: H;
  originY: V;
  overlayX: H;
  overlayY: V;
  offsetX?: number;
  offsetY?: number;
}

/** Anything with a viewport rect — an `Element` or a virtual anchor. */
export interface PositionOrigin {
  getBoundingClientRect(): DOMRect;
}

export interface ConnectedPositionOptions {
  /** Preferred positions in fallback (flip) order. Default `['bottom-start','top-start']`. */
  positions?: (PositionName | ConnectedPosition)[];
  /** Gap (px) between origin and overlay along the connection axis (applied to presets). */
  offset?: number;
  /** Minimum gap (px) to keep from each viewport edge. Default 8. */
  viewportMargin?: number;
  /** Reposition on scroll/resize while attached. Default true. */
  autoUpdate?: boolean;
  /**
   * Grow the overlay to at least the origin's width. Default false.
   *
   * For a dropdown whose panel BELONGS to its trigger — a select's listbox — the two reading
   * as one control depends on them sharing an edge. Without this the panel takes its own
   * `min-width` (a fixed 180px), so it is wider than a short trigger and narrower than a long
   * one, and never simply lines up. A menu or a tooltip wants nothing to do with this: their
   * width is their own business.
   */
  matchOriginWidth?: boolean;
}

export interface ConnectedPositionStrategy extends PositionStrategy {
  /** The position actually applied after flip/shift. Reactive; null before first apply. */
  appliedPosition(): ConnectedPosition | null;
}

/** Map a preset to an explicit pairing, baking the `offset` onto the connection axis. */
function presetToPosition(name: PositionName, offset: number): ConnectedPosition {
  switch (name) {
    case 'bottom': return { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: offset };
    case 'bottom-start': return { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: offset };
    case 'bottom-end': return { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: offset };
    case 'top': return { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -offset };
    case 'top-start': return { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -offset };
    case 'top-end': return { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -offset };
    case 'right': return { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: offset };
    case 'right-start': return { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: offset };
    case 'right-end': return { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: offset };
    case 'left': return { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -offset };
    case 'left-start': return { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -offset };
    case 'left-end': return { originX: 'start', originY: 'bottom', overlayX: 'end', overlayY: 'bottom', offsetX: -offset };
  }
}

function resolve(pos: PositionName | ConnectedPosition, offset: number): ConnectedPosition {
  return typeof pos === 'string' ? presetToPosition(pos, offset) : pos;
}

/** X coordinate of an origin anchor (RTL resolves start↔end to right↔left). */
function originPointX(rect: DOMRect, x: H, rtl: boolean): number {
  if (x === 'center') return rect.left + rect.width / 2;
  const atStart: boolean = (x === 'start') !== rtl;
  return atStart ? rect.left : rect.right;
}
function originPointY(rect: DOMRect, y: V): number {
  if (y === 'center') return rect.top + rect.height / 2;
  return y === 'top' ? rect.top : rect.bottom;
}
/** Fraction of the overlay width its anchor edge sits at (0 = left … 1 = right). */
function overlayFracX(x: H, rtl: boolean): number {
  if (x === 'center') return 0.5;
  const atStart: boolean = (x === 'start') !== rtl;
  return atStart ? 0 : 1;
}
function overlayFracY(y: V): number {
  return y === 'top' ? 0 : y === 'center' ? 0.5 : 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

interface Placement {
  left: number;
  top: number;
  overflow: number;
  pos: ConnectedPosition;
}

/**
 * Create a connected position strategy anchoring the overlay to `origin`. Pass it as
 * `createOverlay({ positionStrategy })`, or call `apply(el)` directly on an attached
 * element.
 */
export function connectedPosition(
  origin: PositionOrigin,
  options: ConnectedPositionOptions = {},
): ConnectedPositionStrategy {
  const offset: number = options.offset ?? 0;
  const margin: number = options.viewportMargin ?? 8;
  const autoUpdate: boolean = options.autoUpdate !== false;
  const positions: ConnectedPosition[] = (options.positions ?? ['bottom-start', 'top-start']).map((p) =>
    resolve(p, offset),
  );

  const _applied: Signal<ConnectedPosition | null> = signal<ConnectedPosition | null>(null);
  let currentEl: HTMLElement | null = null;
  let listening: boolean = false;

  function place(el: HTMLElement, pos: ConnectedPosition, rtl: boolean, vw: number, vh: number): Placement {
    const rect: DOMRect = origin.getBoundingClientRect();
    const w: number = el.offsetWidth;
    const h: number = el.offsetHeight;
    const left: number = originPointX(rect, pos.originX, rtl) - overlayFracX(pos.overlayX, rtl) * w + (pos.offsetX ?? 0);
    const top: number = originPointY(rect, pos.originY) - overlayFracY(pos.overlayY) * h + (pos.offsetY ?? 0);
    const overflow: number =
      Math.max(0, margin - left) +
      Math.max(0, left + w - (vw - margin)) +
      Math.max(0, margin - top) +
      Math.max(0, top + h - (vh - margin));
    return { left, top, overflow, pos };
  }

  function apply(el: HTMLElement): void {
    currentEl = el;
    // Before anything is measured: this widens `el`, and every number below reads its size.
    if (options.matchOriginWidth) {
      el.style.minWidth = `${Math.round(origin.getBoundingClientRect().width)}px`;
    }
    const rtl: boolean = activeDirection() === 'rtl';
    const vw: number = isBrowser ? window.innerWidth : 0;
    const vh: number = isBrowser ? window.innerHeight : 0;

    // First fully-fitting position wins; else the least-overflowing one, then shift.
    let best: Placement | null = null;
    for (const pos of positions) {
      const p: Placement = place(el, pos, rtl, vw, vh);
      if (p.overflow === 0) {
        best = p;
        break;
      }
      if (!best || p.overflow < best.overflow) best = p;
    }
    if (!best) return;

    const w: number = el.offsetWidth;
    const h: number = el.offsetHeight;
    const left: number = clamp(best.left, margin, vw - margin - w);
    const top: number = clamp(best.top, margin, vh - margin - h);

    el.style.position = 'absolute';
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
    _applied.set(best.pos);

    if (autoUpdate && isBrowser && !listening) {
      listening = true;
      window.addEventListener('scroll', reposition, { passive: true, capture: true });
      window.addEventListener('resize', reposition, { passive: true });
    }
  }

  function reposition(): void {
    if (currentEl && currentEl.isConnected) apply(currentEl);
  }

  function dispose(): void {
    if (listening && isBrowser) {
      window.removeEventListener('scroll', reposition, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', reposition);
      listening = false;
    }
    currentEl = null;
  }

  return {
    apply,
    dispose,
    appliedPosition: () => _applied(),
  };
}
