import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string; meta?: string }[];
  sel: () => string;
  setSel: (v: string) => void;
}

/** `disabled` on the list dims every row and blocks all selection at once. */
export function setup(): Setup {
  const sel = signal('starred');
  const items = [
    { value: 'inbox', title: 'Inbox', meta: '12' },
    { value: 'starred', title: 'Starred', meta: '3' },
    { value: 'sent', title: 'Sent' },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
