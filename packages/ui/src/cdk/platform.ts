/**
 * Platform — small, SSR-safe environment queries for the CDK. Zero-dep; only native
 * DOM / `matchMedia`. Capabilities are feature-detected once and memoized; the live
 * reads (`rtl`) reflect the document at call time. Reactive media lives in
 * `breakpoints.ts`; the reactive text direction lives in `bidi.ts` — this module is
 * the static, always-available baseline both build on.
 */

/**
 * True when running in a real browser. Detected via `window`, NOT `document`: Weave's headless render
 * (`runtime/server`) installs a `document` shim as a global so components can build their DOM tree on the
 * server — so `typeof document` is true there too. `window` is the honest browser signal (the shim never
 * installs it), so this stays false during SSR/SSG and every `isBrowser` guard below correctly skips the
 * browser-only paths (layout reads, `matchMedia`, `documentElement.dir`, listeners) that would otherwise
 * touch APIs the shim doesn't provide.
 */
export const isBrowser: boolean = typeof window !== 'undefined';

let _passive: boolean | undefined;

/** Whether the browser supports passive event listeners (feature-detected once). */
export function supportsPassive(): boolean {
  if (_passive !== undefined) return _passive;
  _passive = false;
  if (!isBrowser) return _passive;
  try {
    const opts: object = Object.defineProperty({}, 'passive', {
      get() {
        _passive = true;
        return true;
      },
    });
    const noop = (): void => {};
    window.addEventListener('weave-passive-probe', noop, opts as AddEventListenerOptions);
    window.removeEventListener('weave-passive-probe', noop, opts as AddEventListenerOptions);
  } catch {
    _passive = false;
  }
  return _passive;
}

/** Current document text direction is RTL (`<html dir="rtl">`). Non-reactive snapshot — see `bidi.ts`. */
export function rtl(): boolean {
  return isBrowser && document.documentElement.dir === 'rtl';
}

function mq(query: string): boolean {
  return isBrowser && typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** A fine pointer (mouse / stylus) is available. */
export function hasFinePointer(): boolean {
  return mq('(pointer: fine)');
}

/** A hover-capable pointer is available. */
export function hasHover(): boolean {
  return mq('(hover: hover)');
}

/** The user prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  return mq('(prefers-reduced-motion: reduce)');
}

/** Native Popover API / top-layer support (used by the overlay engine when available). */
export const supportsPopover: boolean =
  isBrowser && typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
