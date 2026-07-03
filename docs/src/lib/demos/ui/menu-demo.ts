import { signal } from '@weave-framework/runtime';
import { menu } from '@weave-framework/ui/menu';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;

interface Setup {
  menu: typeof menu;
  menuOpts: unknown;
  picked: () => string;
}

/** A dropdown menu attached to a trigger button. */
export function setup(): Setup {
  const picked = signal('');
  const menuOpts = {
    items: [
      { value: 'edit', label: 'Edit' },
      { value: 'duplicate', label: 'Duplicate' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v: string | { value: string }) => picked.set(typeof v === 'string' ? v : v.value),
  };
  return { menu, menuOpts, picked };
}
