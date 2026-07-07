import { signal } from '@weave-framework/runtime';
import Menubar from '@weave-framework/ui/menubar';
import type { MenubarMenu } from '@weave-framework/ui/menubar';
import type { MenuItem } from '@weave-framework/ui/menu';

// Capitalized tags in the template resolve to this import.
void Menubar;

interface Setup {
  menus: MenubarMenu[];
  readout: () => string;
  onSelect: (v: string | MenuItem) => void;
}

/**
 * `onSelect` receives the chosen item's value string — but menus carry rich items, so keep the
 * label around to show it. Here we look the picked value back up in the menu data.
 */
export function setup(): Setup {
  const readout = signal('');
  const menus: MenubarMenu[] = [
    {
      label: 'Insert',
      items: [
        { value: 'image', label: 'Image', description: 'From your device' },
        { value: 'table', label: 'Table', description: 'Rows and columns' },
        { value: 'chart', label: 'Chart', description: 'Bar, line or pie' },
      ],
    },
  ];
  const byValue = new Map(menus[0].items.map((it) => [it.value, it] as const));
  const onSelect = (v: string | MenuItem): void => {
    const value = typeof v === 'string' ? v : v.value;
    const it = byValue.get(value);
    readout.set(it ? `${it.label} — ${it.description ?? ''} (value: ${it.value})` : value);
  };
  return { menus, readout, onSelect };
}
