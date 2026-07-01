/**
 * BreakpointObserver — `matchMedia` as a boolean signal, so responsive layout is
 * reactive (a component re-renders when the viewport crosses a breakpoint). SSR-safe:
 * `false` when there's no `matchMedia`. Auto-unsubscribes on owner disposal.
 *
 * Weave's canonical breakpoint is **900px** (`narrow` — README §Responsive); the
 * convenience tiers are provided for apps that want finer control.
 */

import { signal, onDispose, type Signal } from '@weave-framework/runtime';
import { isBrowser } from './platform.js';

/** A boolean signal that tracks whether `query` currently matches. */
export function breakpointSignal(query: string): () => boolean {
  if (!isBrowser || typeof matchMedia !== 'function') {
    const off: Signal<boolean> = signal<boolean>(false);
    return () => off();
  }
  const mql: MediaQueryList = matchMedia(query);
  const state: Signal<boolean> = signal<boolean>(mql.matches);
  const onChange = (): void => {
    state.set(mql.matches);
  };
  mql.addEventListener('change', onChange);
  onDispose(() => mql.removeEventListener('change', onChange));
  return () => state();
}

/** A non-reactive snapshot of whether `query` matches right now. */
export function matchesBreakpoint(query: string): boolean {
  return isBrowser && typeof matchMedia === 'function' ? matchMedia(query).matches : false;
}

/** Named media queries — Weave's `Narrow`/`Wide` (900px) plus convenience tiers. */
export const Breakpoints = {
  /** Weave `narrow` state (single-column reflow). */
  Narrow: '(max-width: 899px)',
  Wide: '(min-width: 900px)',
  Handset: '(max-width: 599px)',
  Tablet: '(min-width: 600px) and (max-width: 1023px)',
  Desktop: '(min-width: 1024px)',
} as const;
