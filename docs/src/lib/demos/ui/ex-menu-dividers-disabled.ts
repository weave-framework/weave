import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  menu: typeof menu;
  fileMenu: MenuOptions;
  ran: () => string;
}

/**
 * `divider: true` drops a hairline separator between groups; `disabled: true` greys an item
 * and skips it in keyboard nav (Up/Down step right over it). Neither is selectable.
 */
export function setup(): Setup {
  const ran = signal('—');
  const fileMenu: MenuOptions = {
    items: [
      { value: 'new', label: 'New file' },
      { value: 'open', label: 'Open…' },
      { value: 'sep1', label: '', divider: true },
      { value: 'save', label: 'Save' },
      { value: 'save-as', label: 'Save as…', disabled: true },
      { value: 'sep2', label: '', divider: true },
      { value: 'close', label: 'Close' },
    ],
    onSelect: (v) => ran.set(String(v)),
  };
  return { menu, fileMenu, ran };
}
