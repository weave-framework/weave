import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string; meta?: string }[];
  sel: () => string;
  setSel: (v: string) => void;
}

/** `class` is forwarded onto the container — hook your own styles off it. */
export function setup(): Setup {
  const sel = signal('mon');
  const items = [
    { value: 'mon', title: 'Monday', meta: '4 tasks' },
    { value: 'tue', title: 'Tuesday', meta: '2 tasks' },
    { value: 'wed', title: 'Wednesday', meta: '7 tasks' },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
