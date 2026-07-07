import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string; meta?: string; disabled?: boolean }[];
  sel: () => string;
  setSel: (v: string) => void;
}

/** A per-row `disabled` skips the row in keyboard nav and blocks selection. */
export function setup(): Setup {
  const sel = signal('inbox');
  const items = [
    { value: 'inbox', title: 'Inbox', meta: '12' },
    { value: 'starred', title: 'Starred', meta: '3' },
    { value: 'sent', title: 'Sent' },
    { value: 'trash', title: 'Trash', disabled: true },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
