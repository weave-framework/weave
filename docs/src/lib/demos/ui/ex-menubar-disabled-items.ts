import { signal } from '@weave-framework/runtime';
import Menubar from '@weave-framework/ui/menubar';
import type { MenubarMenu } from '@weave-framework/ui/menubar';
import type { MenuItem } from '@weave-framework/ui/menu';

// Capitalized tags in the template resolve to this import.
void Menubar;

interface Setup {
  menus: MenubarMenu[];
  picked: () => string;
  onSelect: (v: string | MenuItem) => void;
}

/** An item with `disabled: true` is greyed, unselectable, and skipped by keyboard nav. */
export function setup(): Setup {
  const picked = signal('');
  const menus: MenubarMenu[] = [
    {
      label: 'Edit',
      items: [
        { value: 'undo', label: 'Undo' },
        { value: 'redo', label: 'Redo', disabled: true },
        { value: 'sep', label: '', divider: true },
        { value: 'cut', label: 'Cut' },
        { value: 'copy', label: 'Copy' },
        { value: 'paste', label: 'Paste', disabled: true },
      ],
    },
  ];
  return { menus, picked, onSelect: (v) => picked.set(typeof v === 'string' ? v : v.value) };
}
