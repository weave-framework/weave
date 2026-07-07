import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string; meta?: string }[];
  sel: () => string;
  setSel: (v: string) => void;
}

/** `meta` is quiet trailing text — a count, a size, a timestamp. */
export function setup(): Setup {
  const sel = signal('inbox');
  const items = [
    { value: 'inbox', title: 'Inbox', meta: '12' },
    { value: 'starred', title: 'Starred', meta: '3' },
    { value: 'sent', title: 'Sent', meta: '128' },
    { value: 'archive', title: 'Archive', meta: '1.2k' },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
