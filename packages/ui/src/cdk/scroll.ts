/**
 * Scroll strategies — how an open overlay reacts when the page (or a scrollable
 * ancestor) scrolls. Four behaviors, plus a shared scroll dispatcher so every
 * overlay listens through **one** capture-phase window listener rather than N.
 *
 *   • `repositionScroll` — recompute the panel's position (anchored dropdowns).
 *   • `closeScroll`      — detach the overlay (menus / tooltips).
 *   • `blockScroll`      — lock body scroll while open (dialogs), no layout jump.
 *   • `noopScroll`       — do nothing.
 *
 * Each is a factory `(ref) => ScrollStrategy`, so it drops straight into
 * `createOverlay({ scrollStrategy })`. Zero-dep, signal-friendly. (Note: a
 * `connectedPosition` with `autoUpdate` already repositions on scroll — use that OR
 * `repositionScroll`, not both.)
 */

import { isBrowser } from './platform.js';
import type { OverlayRef } from './overlay.js';

/** Enable/disable hook an overlay calls on attach/detach. */
export interface ScrollStrategy {
  enable(): void;
  disable(): void;
}

/** A factory the overlay invokes with its own ref. */
export type ScrollStrategyFactory = (ref: OverlayRef) => ScrollStrategy;

/* ─────────────────── shared scroll dispatcher ─────────────────── */

type Handler = () => void;
const handlers = new Set<Handler>();
let installed = false;

function fanout(): void {
  for (const h of [...handlers]) h();
}

/**
 * Subscribe to scrolls anywhere in the document (capture phase catches scrollable
 * ancestors, not just `window`). Returns an unsubscribe. One shared listener backs
 * all subscribers.
 */
export function onScroll(handler: Handler): () => void {
  if (!installed && isBrowser) {
    window.addEventListener('scroll', fanout, { capture: true, passive: true });
    installed = true;
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/* ─────────────────────── strategies ─────────────────────── */

/** Do nothing on scroll. */
export function noopScroll(_ref?: OverlayRef): ScrollStrategy {
  return { enable: () => {}, disable: () => {} };
}

/** Recompute the overlay's position on every scroll. */
export function repositionScroll(ref: OverlayRef): ScrollStrategy {
  let off: (() => void) | null = null;
  return {
    enable: () => {
      off ??= onScroll(() => ref.updatePosition());
    },
    disable: () => {
      off?.();
      off = null;
    },
  };
}

/** Detach the overlay on the first scroll (typical for menus / tooltips). */
export function closeScroll(ref: OverlayRef): ScrollStrategy {
  let off: (() => void) | null = null;
  return {
    enable: () => {
      off ??= onScroll(() => ref.detach());
    },
    disable: () => {
      off?.();
      off = null;
    },
  };
}

/**
 * Lock `<body>` scroll while the overlay is open, compensating for the scrollbar
 * width so the page doesn't shift. Restores the exact prior inline styles on disable.
 */
export function blockScroll(_ref?: OverlayRef): ScrollStrategy {
  let prev: { overflow: string; paddingRight: string } | null = null;
  return {
    enable: () => {
      if (!isBrowser || prev) return;
      const scrollbar: number = window.innerWidth - document.documentElement.clientWidth;
      prev = {
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight,
      };
      document.body.style.overflow = 'hidden';
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    },
    disable: () => {
      if (!prev) return;
      document.body.style.overflow = prev.overflow;
      document.body.style.paddingRight = prev.paddingRight;
      prev = null;
    },
  };
}
