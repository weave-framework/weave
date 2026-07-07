import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  menu: typeof menu;
  sortMenu: MenuOptions<string>;
  by: () => string;
}

/**
 * Items can be plain strings — each string is both the value and the label, no accessors
 * needed. `onSelect` then receives that string.
 */
export function setup(): Setup {
  const by = signal('—');
  const sortMenu: MenuOptions<string> = {
    items: ['Name', 'Date modified', 'Size', 'Kind'],
    onSelect: (v) => by.set(String(v)),
  };
  return { menu, sortMenu, by };
}
