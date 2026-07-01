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
  type OptionAccessors,
} from './menu-core.js';

export type { MenuItem, MenuPosition, OptionAccessors } from './menu-core.js';

export interface MenuOptions<T = MenuItem> extends OptionAccessors<T> {
  /** The options — the default `{value,label,description?,disabled?,divider?}`, plain strings,
   * or arbitrary objects (map their fields via the `option*` accessors). */
  items: T[];
  /** Called with the chosen option (value string, or the whole object — see `emit`). */
  onSelect: (selected: string | T) => void;
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
