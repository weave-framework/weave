/**
 * Menu core — the shared overlay panel behind both `use:menu` (anchored to a trigger) and
 * `use:contextMenu` (anchored to a virtual point). Builds a `role=menu` panel of
 * `role=menuitem` buttons in a CDK overlay, wires roving focus (listKeyManager + typeahead,
 * skip-disabled) and the WAI-ARIA menu keyboard (Up/Down/Home/End, Enter/Space activate,
 * Esc/Tab close), plus a transparent click-away backdrop. Internal — not a public subpath;
 * `menu.ts` / `context-menu.ts` are the surfaces. Zero-dep.
 */
import {
  createOverlay,
  connectedPosition,
  listKeyManager,
  type ListKeyManager,
  type OverlayRef,
  type PositionName,
  type PositionOrigin,
} from '../cdk/index.js';

export interface MenuItem {
  /** Value passed to `onSelect`. */
  value: string;
  /** Visible label (also the typeahead text). */
  label: string;
  /** Greyed + skipped by keyboard nav; not selectable. */
  disabled?: boolean;
  /** Render a hairline separator here instead of an item (value/label ignored). */
  divider?: boolean;
}

export interface OpenMenuConfig {
  /** What the panel is anchored to — a trigger element, or a virtual point. */
  origin: PositionOrigin;
  items: MenuItem[];
  /** Preferred positions in flip order. */
  positions: PositionName[];
  /**
   * Highlight (focus) the first item on open. `true` for a keyboard open (↓/Enter/F10) so
   * the user can act immediately; `false` for a pointer open — no item is pre-highlighted
   * (matches native/Material menus), focus rests on the panel and the first arrow moves in.
   */
  focusFirst: boolean;
  /** Called with the chosen item's `value` (the panel is already closing). */
  onSelect: (value: string) => void;
  /** Called after the panel is torn down. `returnFocus` = closed via keyboard/selection. */
  onClose?: (returnFocus: boolean) => void;
}

export interface MenuHandle {
  close(returnFocus: boolean): void;
}

/** A zero-size origin at a viewport point (for context menus / caret-anchored panels). */
export function virtualOrigin(x: number, y: number): PositionOrigin {
  return { getBoundingClientRect: (): DOMRect => new DOMRect(x, y, 0, 0) };
}

/** Open a menu panel. Returns a handle, or null if there's nothing selectable to show. */
export function openMenuPanel(cfg: OpenMenuConfig): MenuHandle | null {
  const enabled = (): MenuItem[] => cfg.items.filter((it) => !it.divider && !it.disabled);
  if (enabled().length === 0) return null;

  let itemEls: HTMLButtonElement[] = []; // enabled items only, index-aligned with `enabled()`
  let closed: boolean = false;
  const km: ListKeyManager<MenuItem> = listKeyManager<MenuItem>(enabled, {
    orientation: 'vertical',
    wrap: true,
    typeahead: true,
    getLabel: (it) => it.label,
  });

  const ref: OverlayRef = createOverlay({
    hasBackdrop: true,
    backdropClass: 'weave-overlay-backdrop--transparent',
    positionStrategy: connectedPosition(cfg.origin, { positions: cfg.positions, offset: 4 }),
  });

  function focusActive(): void {
    const idx: number = km.activeIndex();
    if (idx >= 0 && idx < itemEls.length) itemEls[idx].focus();
  }

  function close(returnFocus: boolean): void {
    if (closed) return;
    closed = true;
    ref.dispose();
    cfg.onClose?.(returnFocus);
  }

  function select(value: string): void {
    close(true);
    cfg.onSelect(value);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const it: MenuItem | null = km.activeItem();
      if (it) select(it.value);
      return;
    }
    if (km.onKeydown(event)) {
      event.preventDefault();
      focusActive();
    }
  }

  const panel: HTMLElement = document.createElement('div');
  panel.className = 'weave-menu';
  panel.setAttribute('role', 'menu');
  for (const it of cfg.items) {
    if (it.divider) {
      const sep: HTMLElement = document.createElement('div');
      sep.className = 'weave-menu__divider';
      sep.setAttribute('role', 'separator');
      panel.appendChild(sep);
      continue;
    }
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weave-menu__item';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1; // roving: focus is moved programmatically
    btn.textContent = it.label;
    if (it.disabled) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    } else {
      itemEls.push(btn);
      btn.addEventListener('click', () => select(it.value));
    }
    panel.appendChild(btn);
  }
  panel.addEventListener('keydown', onKeydown);

  ref.onBackdropClick(() => close(false));
  ref.attach(panel);
  // Focus moves into the menu either way (so the keyboard + Esc work). Keyboard opens land
  // on the first item; pointer opens rest on the panel with nothing highlighted — the first
  // arrow then steps in from the top.
  if (cfg.focusFirst) {
    km.first();
    focusActive();
  } else {
    panel.tabIndex = -1;
    panel.focus();
  }

  return { close };
}
