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
  type ConnectedPosition,
  type ListKeyManager,
  type OverlayRef,
  type PositionName,
  type PositionOrigin,
} from '../cdk/index.js';
import {
  optLabel,
  optDescription,
  optDisabled,
  emitSelection,
  type OptionAccessors,
} from '../shared/options.js';

export type { OptionAccessors } from '../shared/options.js';

/**
 * Where a panel sits relative to its object. Either a named preset (RTL-aware
 * `-start`/`-end`) or an explicit origin↔overlay anchor pair for full 3×3 control.
 * Presets map to the user's mental model:
 *   below:  `bottom-start` (left) · `bottom` (centre) · `bottom-end` (right)
 *   above:  `top-start`    (left) · `top`    (centre) · `top-end`    (right)
 *   side:   `left` / `right` (+ `-start`/`-end` for top/bottom-aligned)
 */
export type MenuPosition = PositionName | ConnectedPosition;

const OPPOSITE: Record<PositionName, PositionName> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  'top-start': 'bottom-start',
  'bottom-start': 'top-start',
  'top-end': 'bottom-end',
  'bottom-end': 'top-end',
  'left-start': 'right-start',
  'right-start': 'left-start',
  'left-end': 'right-end',
  'right-end': 'left-end',
};

/**
 * Build the flip-fallback list from a requested position. A preset gets its opposite
 * appended (so it flips on overflow); an explicit pair is used as-is (shift-clamps to fit);
 * nothing requested falls back to the component default (+ its opposite).
 */
export function buildPositions(position: MenuPosition | undefined, fallback: PositionName): MenuPosition[] {
  if (position == null) return [fallback, OPPOSITE[fallback]];
  if (typeof position === 'string') return [position, OPPOSITE[position]];
  return [position];
}

/**
 * The default authored menu-item shape. Menus can also be driven by arbitrary objects `T`
 * via {@link OptionAccessors} — then `value`/`label`/… are read through the accessors.
 */
export interface MenuItem {
  /** Value emitted on select (default `emit`). */
  value: string;
  /** Visible label (also the typeahead text). */
  label: string;
  /** Optional subtext under the label (smaller, lighter). */
  description?: string;
  /** Greyed + skipped by keyboard nav; not selectable. */
  disabled?: boolean;
  /** Render a hairline separator here instead of an item. */
  divider?: boolean;
}

export interface OpenMenuConfig<T> extends OptionAccessors<T> {
  /** What the panel is anchored to — a trigger element, or a virtual point. */
  origin: PositionOrigin;
  items: T[];
  /** Preferred positions in flip order (see {@link buildPositions}). */
  positions: MenuPosition[];
  /**
   * Highlight (focus) the first item on open. `true` for a keyboard open (↓/Enter/F10) so
   * the user can act immediately; `false` for a pointer open — no item is pre-highlighted
   * (matches native/Material menus), focus rests on the panel and the first arrow moves in.
   */
  focusFirst: boolean;
  /** Is this option a hairline separator (not selectable)? Default: `item.divider`. */
  isDivider?: (item: T) => boolean;
  /** Called with the chosen option (value string, or the whole object — see `emit`). */
  onSelect: (selected: string | T) => void;
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
export function openMenuPanel<T>(cfg: OpenMenuConfig<T>): MenuHandle | null {
  const isDivider = (item: T): boolean =>
    cfg.isDivider ? cfg.isDivider(item) : Boolean((item as { divider?: unknown }).divider);
  const enabled = (): T[] => cfg.items.filter((it) => !isDivider(it) && !optDisabled(it, cfg));
  if (enabled().length === 0) return null;

  let itemEls: HTMLButtonElement[] = []; // enabled items only, index-aligned with `enabled()`
  let closed: boolean = false;
  const km: ListKeyManager<T> = listKeyManager<T>(enabled, {
    orientation: 'vertical',
    wrap: true,
    typeahead: true,
    getLabel: (it) => optLabel(it, cfg),
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

  function select(item: T): void {
    close(true);
    cfg.onSelect(emitSelection(item, cfg));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const it: T | null = km.activeItem();
      if (it != null) select(it);
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
    if (isDivider(it)) {
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
    const label: HTMLElement = document.createElement('span');
    label.className = 'weave-menu__label';
    label.textContent = optLabel(it, cfg);
    btn.appendChild(label);
    const description: string | undefined = optDescription(it, cfg);
    if (description) {
      const desc: HTMLElement = document.createElement('span');
      desc.className = 'weave-menu__description';
      desc.textContent = description;
      btn.appendChild(desc);
    }
    if (optDisabled(it, cfg)) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    } else {
      itemEls.push(btn);
      btn.addEventListener('click', () => select(it));
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
