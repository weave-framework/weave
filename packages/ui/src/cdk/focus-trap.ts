/**
 * Focus trap — keep Tab focus inside a region (dialogs, menus, sheets) and restore it
 * on release. WAI-ARIA modal behavior, zero-dep. Wraps Tab/Shift+Tab at the region's
 * tabbable boundaries, pulls stray focus back in, sets an initial focus target, and
 * returns focus to wherever it was on `deactivate`.
 */

import { tabbableChildren } from './interactivity.js';

export interface FocusTrapOptions {
  /** Where to focus on activate: first tabbable (default), the container, or a specific element. */
  initialFocus?: 'first' | 'container' | HTMLElement;
  /** Restore focus to the previously-focused element on deactivate. Default true. */
  restoreFocus?: boolean;
  /**
   * Make everything outside the trapped region `inert` + `aria-hidden` on activate (true modal
   * shielding: the background can't be reached by AT, pointer, or Tab), and restore on deactivate.
   * Default false. Walks the container's ancestor chain to `<body>`, marking each level's other
   * children — so it works whether the region is portaled near `<body>` (Dialog) or nested in the
   * component tree (over-mode Sidenav). Elements already `inert` (e.g. an outer modal) are left
   * untouched, so stacked modals restore correctly.
   */
  inertBackground?: boolean;
  /**
   * One element to leave interactive while {@link inertBackground} is on — typically the modal's
   * backdrop, which is a sibling of the region and must still receive click-to-dismiss.
   */
  inertIgnore?: HTMLElement | null;
}

/**
 * Shield everything outside `container` (modal background): walk from the container up to `<body>`,
 * marking each ancestor's other element children `inert` + `aria-hidden`. Skips `ignore` (the
 * backdrop) and anything already `inert`. Returns a restore fn that reverts exactly what it changed.
 */
function shieldBackground(container: HTMLElement, ignore: HTMLElement | null): () => void {
  const changed: Array<{ el: HTMLElement; ariaAdded: boolean }> = [];
  let node: HTMLElement | null = container;
  const body: HTMLElement = document.body;
  while (node && node !== body && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || !(sib instanceof HTMLElement)) continue;
      if (ignore && (sib === ignore || sib.contains(ignore))) continue;
      if (sib.hasAttribute('inert')) continue; // already shielded (outer modal) — don't clobber
      const ariaAdded: boolean = !sib.hasAttribute('aria-hidden');
      sib.setAttribute('inert', '');
      if (ariaAdded) sib.setAttribute('aria-hidden', 'true');
      changed.push({ el: sib, ariaAdded });
    }
    node = parent;
  }
  return (): void => {
    for (const { el, ariaAdded } of changed) {
      el.removeAttribute('inert');
      if (ariaAdded) el.removeAttribute('aria-hidden');
    }
    changed.length = 0;
  };
}

export interface FocusTrap {
  /** Start trapping: remember focus, wire the key handler, move focus in. */
  activate(): void;
  /** Stop trapping and (by default) restore the prior focus. */
  deactivate(): void;
  /** Focus the first tabbable (or the container if none). Returns whether anything was focused. */
  focusFirst(): boolean;
  /** The current tabbable boundaries, in DOM order. */
  tabbables(): HTMLElement[];
}

function focusContainer(container: HTMLElement): void {
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  container.focus();
}

/** Create a focus trap for `container`. Inert until {@link FocusTrap.activate}. */
export function focusTrap(container: HTMLElement, options: FocusTrapOptions = {}): FocusTrap {
  const restoreFocus: boolean = options.restoreFocus !== false;
  let previouslyFocused: HTMLElement | null = null;
  let active: boolean = false;
  let releaseShield: (() => void) | null = null;

  const tabbables = (): HTMLElement[] => tabbableChildren(container);

  function focusFirst(): boolean {
    const items: HTMLElement[] = tabbables();
    if (items.length > 0) {
      items[0].focus();
      return true;
    }
    focusContainer(container);
    return false;
  }

  function focusInitial(): void {
    const init: 'first' | 'container' | HTMLElement | undefined = options.initialFocus;
    if (init instanceof HTMLElement) init.focus();
    else if (init === 'container') focusContainer(container);
    else focusFirst();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items: HTMLElement[] = tabbables();
    if (items.length === 0) {
      event.preventDefault();
      focusContainer(container);
      return;
    }
    const first: HTMLElement = items[0];
    const last: HTMLElement = items[items.length - 1];
    const activeEl: Element | null = document.activeElement;

    if (!container.contains(activeEl)) {
      // Focus escaped the region — pull it back to the appropriate edge.
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeEl === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeEl === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    activate(): void {
      if (active) return;
      active = true;
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (options.inertBackground) releaseShield = shieldBackground(container, options.inertIgnore ?? null);
      container.addEventListener('keydown', onKeydown);
      focusInitial();
    },
    deactivate(): void {
      if (!active) return;
      active = false;
      container.removeEventListener('keydown', onKeydown);
      // Un-shield BEFORE restoring focus — the opener lives in the background and can't be
      // focused while still `inert`.
      releaseShield?.();
      releaseShield = null;
      if (restoreFocus && previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
      previouslyFocused = null;
    },
    focusFirst,
    tabbables,
  };
}
