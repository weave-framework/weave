import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  menu: typeof menu;
  below: MenuOptions;
  above: MenuOptions;
  right: MenuOptions;
  picked: () => string;
}

/**
 * `position` picks where the panel sits relative to the trigger — a preset
 * (`'bottom-start'`, `'top-end'`, `'right-start'`, …) or an explicit anchor pair. It flips to
 * the opposite side on overflow. The same `items` drive all three triggers here.
 */
export function setup(): Setup {
  const picked = signal('—');
  const items = [
    { value: 'cut', label: 'Cut' },
    { value: 'copy', label: 'Copy' },
    { value: 'paste', label: 'Paste' },
  ];
  const onSelect = (v: string | { value: string }): void =>
    picked.set(typeof v === 'string' ? v : v.value);
  const below: MenuOptions = { items, onSelect, position: 'bottom-end' };
  const above: MenuOptions = { items, onSelect, position: 'top-start' };
  const right: MenuOptions = { items, onSelect, position: 'right-start' };
  return { menu, below, above, right, picked };
}
