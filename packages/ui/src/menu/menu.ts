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
import { openMenuPanel, type MenuHandle, type MenuItem } from './menu-core.js';
import type { PositionName } from '../cdk/index.js';

export type { MenuItem } from './menu-core.js';

export interface MenuOptions {
  items: MenuItem[];
  /** Called with the chosen item's `value` (the menu then closes). */
  onSelect: (value: string) => void;
  /** Preferred anchor position; flips to the opposite on overflow. Default `'bottom-start'`. */
  position?: PositionName;
}

/** Weave `use:` action: `(trigger, options) => cleanup`. */
export function menu(trigger: HTMLElement, options: MenuOptions): () => void {
  let handle: MenuHandle | null = null;

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  function openMenu(focusFirst: boolean): void {
    if (handle) return;
    handle = openMenuPanel({
      origin: trigger,
      items: options.items,
      positions: [options.position ?? 'bottom-start', 'top-start'],
      focusFirst,
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
