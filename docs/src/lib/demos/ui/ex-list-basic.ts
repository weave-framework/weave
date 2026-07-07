import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string }[];
  sel: () => string;
  setSel: (v: string) => void;
}

/** A selectable list (listbox) bound to the selected row's key via value + onChange. */
export function setup(): Setup {
  const sel = signal('inbox');
  const items = [
    { value: 'inbox', title: 'Inbox' },
    { value: 'starred', title: 'Starred' },
    { value: 'sent', title: 'Sent' },
    { value: 'drafts', title: 'Drafts' },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
