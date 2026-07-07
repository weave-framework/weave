import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  menu: typeof menu;
  viewMenu: MenuOptions;
  density: () => string;
}

/**
 * A **value-picker** menu: `selected` marks the row whose value it equals with a check
 * (`role=menuitemradio` + `aria-checked`). Pass a getter (`selected: () => density()`) so the
 * mark tracks the value — it's re-read on every open, so re-opening always shows the current
 * choice ticked.
 */
export function setup(): Setup {
  const density = signal('comfortable');
  const viewMenu: MenuOptions = {
    items: [
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'cozy', label: 'Cozy' },
      { value: 'compact', label: 'Compact' },
    ],
    selected: () => density(),
    onSelect: (v) => density.set(String(v)),
  };
  return { menu, viewMenu, density };
}
