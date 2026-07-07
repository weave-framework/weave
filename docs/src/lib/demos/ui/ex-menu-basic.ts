import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  menu: typeof menu;
  actions: MenuOptions;
  picked: () => string;
}

/**
 * The minimal menu: `items` of `{ value, label }` and an `onSelect` callback. The options
 * object lives in setup, never inline — an inline object literal as a `use:` argument
 * compiles to `() => { … }`, which JS reads as a block (the options are silently lost).
 */
export function setup(): Setup {
  const picked = signal('—');
  const actions: MenuOptions = {
    items: [
      { value: 'edit', label: 'Edit' },
      { value: 'duplicate', label: 'Duplicate' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v) => picked.set(String(v)),
  };
  return { menu, actions, picked };
}
