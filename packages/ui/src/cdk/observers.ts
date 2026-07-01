/**
 * Observers — native `ResizeObserver` / `MutationObserver` wrapped as signals, so DOM
 * geometry and structure become part of the reactive graph (no polling, no zones).
 * Each observer auto-disconnects when the surrounding owner scope disposes.
 */

import { signal, onDispose, type Signal } from '@weave-framework/runtime';
import { isBrowser } from './platform.js';

export interface Size {
  width: number;
  height: number;
}

/** A signal of `el`'s content-box size, updated via `ResizeObserver`. */
export function resizeSignal(el: Element): () => Size {
  const rect: DOMRect = el.getBoundingClientRect();
  const size: Signal<Size> = signal<Size>({ width: rect.width, height: rect.height });
  if (isBrowser && typeof ResizeObserver !== 'undefined') {
    const ro: ResizeObserver = new ResizeObserver((entries) => {
      const box: DOMRectReadOnly = entries[entries.length - 1].contentRect;
      size.set({ width: box.width, height: box.height });
    });
    ro.observe(el);
    onDispose(() => ro.disconnect());
  }
  return () => size();
}

/**
 * A signal that increments on every DOM mutation of `target` (a change counter — read
 * it in an `effect`/`computed` to re-run on structure/attribute/text changes).
 */
export function mutationSignal(
  target: Node,
  options: MutationObserverInit = { childList: true, subtree: true, attributes: true, characterData: true },
): () => number {
  const tick: Signal<number> = signal<number>(0);
  if (isBrowser && typeof MutationObserver !== 'undefined') {
    const mo: MutationObserver = new MutationObserver(() => tick.set(tick() + 1));
    mo.observe(target, options);
    onDispose(() => mo.disconnect());
  }
  return () => tick();
}
