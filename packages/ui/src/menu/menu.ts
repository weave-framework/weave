/**
 * Menu — a dropdown of actions, applied as a Weave `use:` action to a trigger element:
 *
 *   <button use:menu={{ { items: [{value:'edit',label:'Edit'}, {value:'del',label:'Delete'}],
 *                        onSelect: (v) => run(v) } }}>Actions ▾</button>
 *
 * Click (or ArrowDown / Enter / Space) opens a CDK-overlay panel anchored under the
 * trigger; keyboard, roving focus, typeahead, click-away and focus-return are handled by
 * the shared menu core. The trigger carries `aria-haspopup=menu` + `aria-expanded`. The
 * visual is `menu.styles()` (the `--weave-menu-*` republic). Zero-dep.
 */
import {
  openMenuPanel,
  buildPositions,
  type MenuHandle,
  type MenuItem,
  type MenuPosition,
  type MenuRowContext,
  type OptionAccessors,
} from './menu-core.js';

export type { MenuItem, MenuPosition, MenuRowContext, OptionAccessors } from './menu-core.js';

export interface MenuOptions<T = MenuItem> extends OptionAccessors<T> {
  /** The options — the default `{value,label,description?,disabled?,divider?}`, plain strings,
   * or arbitrary objects (map their fields via the `option*` accessors). */
  items: T[];
  /** Called with the chosen option (value string, or the whole object — see `emit`). */
  onSelect: (selected: string | T) => void;
  /**
   * Make it a **value picker**: the item whose value equals this shows a check
   * (`role=menuitemradio` + `aria-checked`) — e.g. the current language/view. Pass a getter
   * (`selected: () => lang()`) so the mark tracks the value; it's read on every open. Omit
   * for a plain action menu.
   */
  selected?: string | (() => string | undefined);
  /**
   * Custom row content: returns a DOM node rendered as the row body in place of the default
   * label span — a flag, an icon, a colour swatch, an avatar + text, any authored markup.
   * `optionLabel` still drives the accessible name + typeahead. Omit for plain text rows.
   */
  optionContent?: (item: T) => Node;
  /**
   * Per-row **template** — an authored `@snippet` taking the row context and returning the
   * row body. When supplied it renders the ENTIRE row (weave stamps no default label/check),
   * so the template owns the layout, the marker (its position + icon) and the selected/active
   * styling — binding `row.item.*`, `row.checked`, `row.active()`, `row.index`, `row.disabled`.
   * `optionLabel` still drives the accessible name + typeahead; `selected` still sets the ARIA.
   * Takes precedence over {@link optionContent}. Omit for plain text rows.
   */
  itemTemplate?: (row: MenuRowContext<T>) => Node;
  /** Is this option a hairline separator? Default: `item.divider`. */
  isDivider?: (item: T) => boolean;
  /**
   * Where the panel sits relative to the trigger; flips to the opposite on overflow.
   * A preset (`'bottom-start'`, `'top'`, `'bottom-end'`, …) or an explicit anchor pair.
   * Default `'bottom-start'` (below, left-aligned).
   */
  position?: MenuPosition;
}

/** Weave `use:` action: `(trigger, options) => cleanup`. */
export function menu<T = MenuItem>(trigger: HTMLElement, options: MenuOptions<T>): () => void {
  let handle: MenuHandle | null = null;

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  function openMenu(focusFirst: boolean): void {
    if (handle) return;
    handle = openMenuPanel<T>({
      origin: trigger,
      items: options.items,
      positions: buildPositions(options.position, 'bottom-start'),
      focusFirst,
      isDivider: options.isDivider,
      selected: options.selected,
      optionContent: options.optionContent,
      itemTemplate: options.itemTemplate,
      optionValue: options.optionValue,
      optionLabel: options.optionLabel,
      optionDescription: options.optionDescription,
      optionDisabled: options.optionDisabled,
      emit: options.emit,
      onSelect: options.onSelect,
      onClose: (returnFocus: boolean): void => {
        handle = null;
        trigger.setAttribute('aria-expanded', 'false');
        if (returnFocus) trigger.focus();
      },
    });
    if (handle) trigger.setAttribute('aria-expanded', 'true');
  }

  // Click = pointer open (no item pre-highlighted); ↓/Enter/Space = keyboard open (first item).
  const onTriggerClick = (): void => {
    if (handle) handle.close(true);
    else openMenu(false);
  };
  const onTriggerKeydown = (event: KeyboardEvent): void => {
    if (handle) return; // once open, the panel owns the keyboard
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(true);
    }
  };

  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeydown);

  return (): void => {
    handle?.close(false);
    trigger.removeEventListener('click', onTriggerClick);
    trigger.removeEventListener('keydown', onTriggerKeydown);
    trigger.removeAttribute('aria-haspopup');
    trigger.removeAttribute('aria-expanded');
  };
}
