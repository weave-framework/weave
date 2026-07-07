/**
 * Menu core — the shared overlay panel behind both `use:menu` (anchored to a trigger) and
 * `use:contextMenu` (anchored to a virtual point). Builds a `role=menu` panel of
 * `role=menuitem` buttons in a CDK overlay, wires roving focus (listKeyManager + typeahead,
 * skip-disabled) and the WAI-ARIA menu keyboard (Up/Down/Home/End, Enter/Space activate,
 * Esc/Tab close), plus a transparent click-away backdrop. Internal — not a public subpath;
 * `menu.ts` / `context-menu.ts` are the surfaces. Zero-dep.
 */
import { root } from '@weave-framework/runtime';
import {
  createOverlay,
  connectedPosition,
  listKeyManager,
  type ListKeyManager,
  type OverlayRef,
  type PositionOrigin,
} from '../cdk/index.js';
import {
  optValue,
  optLabel,
  optDescription,
  optDisabled,
  emitSelection,
  type OptionAccessors,
} from '../shared/options.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

export type { OptionAccessors } from '../shared/options.js';
export { buildPositions, type MenuPosition } from '../shared/positions.js';

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

/**
 * The full per-row context handed to an {@link OpenMenuConfig.itemTemplate}. The template
 * (an authored `@snippet`) owns the whole row — layout, marker (position + icon), and
 * selected/active styling — binding these fields.
 */
export interface MenuRowContext<T> {
  /** The row's data object — every field of the source JSON item (bind `row.item.*`). */
  item: T;
  /** Accessor-resolved value (`optionValue`). */
  value: string;
  /** Accessor-resolved label (`optionLabel`) — also the accessible name + typeahead text. */
  label: string;
  /** Accessor-resolved subtext (`optionDescription`), if any. */
  description: string | undefined;
  /** Is the row disabled (greyed, skipped by keyboard nav, not selectable). */
  disabled: boolean;
  /** Zero-based position among the (non-divider) rows. */
  index: number;
  /**
   * True when the row's value equals the menu's `selected` (the value-picker mark). A
   * snapshot taken at open time — same semantics as the built-in check (re-read on re-open).
   */
  checked: boolean;
  /**
   * Reactive: true while this row is the keyboard-highlighted (roving-focused) one. Read it
   * in a binding (`class:is-active={{ row.active() }}`, `@if (row.active())`) to restyle the
   * active row live as the user arrows through. Always false for a disabled row.
   */
  active: () => boolean;
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
  /**
   * Turns the menu into a **value picker**: the item whose value equals this is marked
   * `role=menuitemradio` + `aria-checked` with a leading check. A getter is read on every
   * open, so it stays in sync as the value changes. Omit for a plain action menu.
   */
  selected?: string | (() => string | undefined);
  /**
   * Custom row content. Returns a DOM node rendered as the row body in place of the default
   * label/description spans — a flag, an icon, a colour swatch, an avatar + text, any authored
   * markup. `optionLabel` still drives the accessible name (`aria-label`) and typeahead, so
   * keyboard search keeps working even when the visible content is custom. Omit for text rows.
   */
  optionContent?: (item: T) => Node;
  /**
   * Per-row **template** (an authored `@snippet`), invoked once per row with its full
   * {@link MenuRowContext} and returning the row body. When supplied it renders the ENTIRE
   * row — weave stamps no default label/check markup — so the template owns the layout,
   * the marker (position + icon) and the selected/active styling. `optionLabel` still drives
   * the accessible name + typeahead, and `selected` still sets `role=menuitemradio` +
   * `aria-checked`; only the *visible* marker becomes the template's job. Takes precedence
   * over {@link optionContent}. Its reactive bindings are owned by the panel and disposed on
   * close. Omit for the default text rows.
   */
  itemTemplate?: (row: MenuRowContext<T>) => Node;
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
  // Disposes the reactive owner behind `itemTemplate` rows (their bindings' effects), if any.
  let rowsDispose: (() => void) | null = null;
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
    rowsDispose?.(); // tear down any row-template bindings before the DOM goes
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

  // A value-picker menu (selection marking) when `selected` is supplied. A getter is read
  // now, at open time, so the check reflects the current value on every re-open.
  const selectedValue: string | undefined =
    typeof cfg.selected === 'function' ? cfg.selected() : cfg.selected;
  const selectable: boolean = selectedValue !== undefined && selectedValue !== null;

  // A per-row template (FW-10) owns the WHOLE row: layout, marker, selected/active styling.
  // When present weave stamps no default label/check gutter — `selected` still sets the ARIA
  // (radio + aria-checked) but the visible marker is the template's job. Its reactive bindings
  // are created inside `root()` and torn down (via `rowsDispose`) when the panel closes.
  const templated: boolean = typeof cfg.itemTemplate === 'function';

  const panel: HTMLElement = document.createElement('div');
  panel.className = selectable && !templated ? 'weave-menu weave-menu--selectable' : 'weave-menu';
  panel.setAttribute('role', 'menu');

  let rowIndex: number = -1; // 0-based across non-divider rows
  let enabledIndex: number = -1; // 0-based across enabled rows (aligns with `km` + `itemEls`)

  const buildRows = (): void => {
    for (const it of cfg.items) {
      if (isDivider(it)) {
        const sep: HTMLElement = document.createElement('div');
        sep.className = 'weave-menu__divider';
        sep.setAttribute('role', 'separator');
        panel.appendChild(sep);
        continue;
      }
      const disabled: boolean = optDisabled(it, cfg);
      rowIndex += 1;
      const myEnabledIndex: number = disabled ? -1 : (enabledIndex += 1);

      const btn: HTMLButtonElement = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = -1; // roving: focus is moved programmatically
      // Value-picker rows are radios (aria-checked); plain action rows are menuitems.
      const checked: boolean = selectable && optValue(it, cfg) === selectedValue;

      if (templated) {
        // The author's row template is the entire row — no check gutter / body column.
        btn.className = 'weave-menu__item weave-menu__item--templated';
        btn.setAttribute('role', selectable ? 'menuitemradio' : 'menuitem');
        if (selectable) btn.setAttribute('aria-checked', checked ? 'true' : 'false');
        const rowCtx: MenuRowContext<T> = {
          item: it,
          value: optValue(it, cfg),
          label: optLabel(it, cfg),
          description: optDescription(it, cfg),
          disabled,
          index: rowIndex,
          checked,
          active: disabled ? (): boolean => false : (): boolean => km.activeIndex() === myEnabledIndex,
        };
        btn.appendChild(cfg.itemTemplate!(rowCtx));
        // The visible content is custom, so `optionLabel` provides the accessible name.
        btn.setAttribute('aria-label', optLabel(it, cfg));
      } else {
        btn.className = selectable ? 'weave-menu__item weave-menu__item--radio' : 'weave-menu__item';
        if (selectable) {
          btn.setAttribute('role', 'menuitemradio');
          btn.setAttribute('aria-checked', checked ? 'true' : 'false');
          // Empty gutter span; the ✓ glyph is drawn by CSS off `[aria-checked=true]`.
          const check: HTMLElement = document.createElement('span');
          check.className = 'weave-menu__check';
          check.setAttribute('aria-hidden', 'true');
          btn.appendChild(check);
        } else {
          btn.setAttribute('role', 'menuitem');
        }
        // The row body — the default label (+ optional description), or author-supplied custom
        // content — lives in a body column so the check sits in a left gutter for value-picker rows.
        const body: HTMLElement = selectable ? document.createElement('span') : btn;
        if (selectable) body.className = 'weave-menu__body';
        const custom: Node | undefined = cfg.optionContent ? cfg.optionContent(it) : undefined;
        if (custom) {
          // Author-controlled row content (a flag, an icon, a swatch, an avatar + text…) replaces
          // the default label/description spans. `optionLabel` still supplies the accessible name
          // (aria-label, below) and typeahead, so keyboard search keeps working even though the
          // visible content is custom markup. FW-9.
          body.appendChild(custom);
          btn.setAttribute('aria-label', optLabel(it, cfg));
        } else {
          const label: HTMLElement = document.createElement('span');
          label.className = 'weave-menu__label';
          label.textContent = optLabel(it, cfg);
          body.appendChild(label);
          const description: string | undefined = optDescription(it, cfg);
          if (description) {
            const desc: HTMLElement = document.createElement('span');
            desc.className = 'weave-menu__description';
            desc.textContent = description;
            body.appendChild(desc);
          }
        }
        if (selectable) btn.appendChild(body);
      }

      if (disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        itemEls.push(btn);
        btn.addEventListener('click', () => select(it));
      }
      panel.appendChild(btn);
    }
  };

  // Templated rows carry reactive bindings — build them inside a disposable root owner so
  // their effects tear down on close. The default (text) path creates no effects, so it stays
  // outside a root (byte-for-byte unchanged).
  if (templated) root((dispose) => ((rowsDispose = dispose), buildRows()));
  else buildRows();

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
