import { signal } from '@weave-framework/runtime';
import { contextMenu, type MenuItem } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  picked: () => string;
}

/**
 * The full default item shape: `label`, an optional `description` subtext line, a
 * `disabled` item (greyed + skipped by keyboard nav), and a `divider` hairline separator
 * between groups.
 */
export function setup(): Setup {
  const picked = signal('');
  const items: MenuItem[] = [
    { value: 'edit', label: 'Edit', description: 'Rename this item' },
    { value: 'duplicate', label: 'Duplicate' },
    { value: 'archive', label: 'Archive', disabled: true },
    { value: 'sep', divider: true, label: '' },
    { value: 'delete', label: 'Delete', description: 'Permanent' },
  ];
  const ctxOpts = {
    items,
    onSelect: (v: string | MenuItem) => picked.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, picked };
}
