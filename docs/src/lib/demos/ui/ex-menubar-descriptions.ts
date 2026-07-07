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

/** A `description` renders as smaller, lighter subtext under the item label. */
export function setup(): Setup {
  const picked = signal('');
  const menus: MenubarMenu[] = [
    {
      label: 'File',
      items: [
        { value: 'new', label: 'New file', description: 'Start with a blank document' },
        { value: 'open', label: 'Open…', description: 'Browse for an existing file' },
        { value: 'save', label: 'Save', description: 'Write changes to disk' },
      ],
    },
    {
      label: 'Share',
      items: [
        { value: 'link', label: 'Copy link', description: 'Anyone with the link can view' },
        { value: 'invite', label: 'Invite people', description: 'Send an email invitation' },
      ],
    },
  ];
  return { menus, picked, onSelect: (v) => picked.set(typeof v === 'string' ? v : v.value) };
}
