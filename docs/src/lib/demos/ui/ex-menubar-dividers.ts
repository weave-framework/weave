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

/** An item with `divider: true` renders a hairline separator instead of a row. */
export function setup(): Setup {
  const picked = signal('');
  const menus: MenubarMenu[] = [
    {
      label: 'File',
      items: [
        { value: 'new', label: 'New' },
        { value: 'open', label: 'Open' },
        { value: 'sep-1', label: '', divider: true },
        { value: 'save', label: 'Save' },
        { value: 'save-as', label: 'Save as…' },
        { value: 'sep-2', label: '', divider: true },
        { value: 'close', label: 'Close' },
      ],
    },
  ];
  return { menus, picked, onSelect: (v) => picked.set(typeof v === 'string' ? v : v.value) };
}
