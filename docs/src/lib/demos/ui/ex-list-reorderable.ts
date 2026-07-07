import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';
import { moveItemInArray, type DropEvent } from '@weave-framework/ui/cdk';

// Capitalized tags in the template resolve to this import.
void List;

interface Row {
  value: string;
  title: string;
  meta?: string;
}
interface Setup {
  items: () => Row[];
  sel: () => string;
  setSel: (v: string) => void;
  onReorder: (event: DropEvent) => void;
}

/**
 * `reorderable` shows a drag handle per row; `onReorder` fires on a committed drop.
 * The list is controlled — reorder `items` yourself with `moveItemInArray`.
 */
export function setup(): Setup {
  const sel = signal('a');
  const items = signal<Row[]>([
    { value: 'a', title: 'First', meta: '↕' },
    { value: 'b', title: 'Second', meta: '↕' },
    { value: 'c', title: 'Third', meta: '↕' },
    { value: 'd', title: 'Fourth', meta: '↕' },
  ]);
  const onReorder = ({ previousIndex, currentIndex }: DropEvent): void => {
    items.set(moveItemInArray(items(), previousIndex, currentIndex));
  };
  return { items, sel, setSel: (v) => sel.set(v), onReorder };
}
