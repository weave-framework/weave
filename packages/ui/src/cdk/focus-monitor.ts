/**
 * Focus monitor — *how* an element got focused (keyboard / mouse / touch / program),
 * as a signal. This is what powers correct `:focus-visible`-style rings: show a ring
 * for keyboard focus, not for a mouse click. Zero-dep, signal-native.
 *
 * Modality is tracked globally: an interaction (keydown/mousedown/touchstart) marks
 * the current modality, which clears on the next microtask — so a focus that lands in
 * the same turn as an interaction inherits it, while a programmatic `el.focus()` in a
 * later turn reads as `'program'`.
 */

import { signal, onDispose, type Signal } from '@weave-framework/runtime';
import { isBrowser } from './platform.js';

export type FocusOrigin = 'keyboard' | 'mouse' | 'touch' | 'program';

let modality: FocusOrigin | null = null;
let installed: boolean = false;
const _origin: Signal<FocusOrigin | null> = signal<FocusOrigin | null>(null);

function mark(origin: FocusOrigin): void {
  modality = origin;
  // Clear after the current turn: a focus not caused by this interaction reads 'program'.
  queueMicrotask(() => {
    modality = null;
  });
}

function ensureInstalled(): void {
  if (installed || !isBrowser) return;
  installed = true;
  document.addEventListener('keydown', () => mark('keyboard'), true);
  document.addEventListener('mousedown', () => mark('mouse'), true);
  document.addEventListener('touchstart', () => mark('touch'), true);
  document.addEventListener('focusin', () => _origin.set(modality ?? 'program'), true);
}

/** The origin of the most recent focus in the document. Reactive; null before any focus. */
export function focusOrigin(): FocusOrigin | null {
  ensureInstalled();
  return _origin();
}

export interface FocusMonitorRef {
  /** The origin of `el`'s current focus, or null when `el` (and its descendants) are unfocused. Reactive. */
  origin(): FocusOrigin | null;
  /** Whether `el` (or a descendant) currently holds focus. Reactive. */
  focused(): boolean;
  /** Stop monitoring and release listeners. */
  stop(): void;
}

/**
 * Monitor a specific element's focus origin. Fires for the element and its
 * descendants (focus within). Auto-stops when the surrounding owner disposes.
 */
export function monitorFocus(el: HTMLElement): FocusMonitorRef {
  ensureInstalled();
  const origin: Signal<FocusOrigin | null> = signal<FocusOrigin | null>(null);

  const onFocusIn = (): void => {
    origin.set(modality ?? 'program');
  };
  const onFocusOut = (event: FocusEvent): void => {
    // Leaving the element entirely (not just moving between its descendants).
    const next: Node | null = event.relatedTarget as Node | null;
    if (!next || !el.contains(next)) origin.set(null);
  };

  el.addEventListener('focusin', onFocusIn);
  el.addEventListener('focusout', onFocusOut);

  const stop = (): void => {
    el.removeEventListener('focusin', onFocusIn);
    el.removeEventListener('focusout', onFocusOut);
  };
  onDispose(stop);

  return {
    origin: () => origin(),
    focused: () => origin() !== null,
    stop,
  };
}
