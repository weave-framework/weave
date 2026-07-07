import List from '@weave-framework/ui/list';

// Capitalized tags in the template resolve to this import.
void List;

interface Setup {
  items: { value: string; title: string; meta?: string }[];
}

/** `selectable={{ false }}` renders a plain semantic list — no selection, no keyboard focus. */
export function setup(): Setup {
  const items = [
    { value: 'a', title: 'Signal-native rendering' },
    { value: 'b', title: 'Zero runtime dependencies' },
    { value: 'c', title: 'Compiled templates', meta: 'AOT' },
    { value: 'd', title: 'First-class forms' },
  ];
  return { items };
}
