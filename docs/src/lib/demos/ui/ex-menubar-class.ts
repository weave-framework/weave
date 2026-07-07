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

/** `class` is forwarded onto the `role="menubar"` container so you can theme the bar. */
export function setup(): Setup {
  const picked = signal('');
  const menus: MenubarMenu[] = [
    { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'save', label: 'Save' }] },
    { label: 'Help', items: [{ value: 'docs', label: 'Documentation' }, { value: 'about', label: 'About' }] },
  ];
  return { menus, picked, onSelect: (v) => picked.set(typeof v === 'string' ? v : v.value) };
}
