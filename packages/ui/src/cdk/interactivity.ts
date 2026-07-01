/**
 * Interactivity checker — "can this element be focused / tabbed to?" The primitive
 * the focus-trap and key-managers stand on. Pure DOM inspection, zero-dep.
 *
 * `isFocusable` = can receive focus (naturally focusable, or has any `tabindex`),
 * visible, and not disabled. `isTabbable` = focusable AND in the sequential tab order
 * (`tabindex >= 0`). `getClientRects()` catches ancestor `display:none` too.
 */

const NATIVE_FOCUSABLE = new Set(['input', 'select', 'textarea', 'button']);

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style: CSSStyleDeclaration = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return el.getClientRects().length > 0;
}

function isDisabled(el: HTMLElement): boolean {
  try {
    return el.matches(':disabled');
  } catch {
    return el.hasAttribute('disabled');
  }
}

function isNativelyFocusable(el: HTMLElement): boolean {
  const tag: string = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
  if (NATIVE_FOCUSABLE.has(tag)) return true;
  if (tag === 'iframe' || tag === 'object' || tag === 'embed') return true;
  if (tag === 'audio' || tag === 'video') return el.hasAttribute('controls');
  return el.isContentEditable;
}

/** The element's effective tabindex: explicit attribute, else 0 if natively focusable, else -1. */
export function getTabIndex(el: HTMLElement): number {
  const attr: string | null = el.getAttribute('tabindex');
  if (attr != null) {
    const n: number = parseInt(attr, 10);
    return Number.isNaN(n) ? -1 : n;
  }
  return isNativelyFocusable(el) ? 0 : -1;
}

/** Whether `el` can receive focus at all (incl. `tabindex="-1"`). */
export function isFocusable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (isDisabled(el) || !isVisible(el)) return false;
  const attr: string | null = el.getAttribute('tabindex');
  if (attr != null && !Number.isNaN(parseInt(attr, 10))) return true;
  return isNativelyFocusable(el);
}

/** Whether `el` is reachable by sequential Tab navigation (`tabindex >= 0`). */
export function isTabbable(el: Element): boolean {
  return isFocusable(el) && getTabIndex(el as HTMLElement) >= 0;
}

/** All focusable descendants of `container`, in DOM order. */
export function focusableChildren(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(isFocusable);
}

/** All tabbable descendants of `container`, in DOM order. */
export function tabbableChildren(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(isTabbable);
}
