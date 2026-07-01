/**
 * Ripple — a click-feedback behavior, applied as a Weave `use:` action to any host:
 *
 *   <button use:ripple>Save</button>
 *   <button use:ripple={{ { centered: true } }}>Enter-friendly</button>
 *
 * On pointerdown it appends an absolutely-positioned circle at the click point that
 * scales up and fades out (Keyline: currentColor, opacity .22, scale→4 over ~.55s),
 * removed on animationend. The visual is driven by `ripple.styles()` (CSS + tokens);
 * this file is only the behavior. Respects prefers-reduced-motion. Zero-dep.
 */
export interface RippleOptions {
  /** Emanate from the host centre instead of the pointer (e.g. keyboard activation). */
  centered?: boolean;
  /** Suppress ripples without detaching the action. */
  disabled?: boolean;
}

/** Weave `use:` action: `(el, options?) => cleanup`. */
export function ripple(host: HTMLElement, options: RippleOptions = {}): () => void {
  ensureHost(host);

  const onPointerDown = (event: PointerEvent): void => {
    if (options.disabled) return;

    const rect = host.getBoundingClientRect();
    const x = options.centered ? rect.width / 2 : event.clientX - rect.left;
    const y = options.centered ? rect.height / 2 : event.clientY - rect.top;
    // Radius reaches the farthest corner so the circle covers the whole host.
    const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));

    const span = document.createElement('span');
    span.className = 'weave-ripple';
    span.setAttribute('aria-hidden', 'true');
    span.style.left = `${x - radius}px`;
    span.style.top = `${y - radius}px`;
    span.style.width = `${radius * 2}px`;
    span.style.height = `${radius * 2}px`;
    host.appendChild(span);

    if (prefersReducedMotion()) {
      span.remove();
      return;
    }
    span.addEventListener('animationend', () => span.remove(), { once: true });
  };

  host.addEventListener('pointerdown', onPointerDown);
  return () => host.removeEventListener('pointerdown', onPointerDown);
}

// The ripple is absolutely positioned and must be clipped — nudge the host if the
// author hasn't (also available as the `weave.ripple-host` mixin for authored styles).
function ensureHost(host: HTMLElement): void {
  const cs = getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';
  if (cs.overflow === 'visible') host.style.overflow = 'hidden';
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
