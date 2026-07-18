import { signal } from '@weave-framework/runtime';
import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Node {
  label: string;
}
interface DropEvent {
  previousIndex: number;
  currentIndex: number;
}
interface Setup {
  nodes: () => Node[];
  onReorder: (event: DropEvent) => void;
}

/**
 * `reorderable` adds a per-node drag handle. On a committed drag Tree emits `onReorder`
 * with indices over the visible order; the consumer applies it to its own model — here we
 * move the item in a signal-backed array.
 */
export function setup(): Setup {
  const nodes = signal<Node[]>([
    { label: 'Home' },
    { label: 'Docs' },
    { label: 'Blog' },
    { label: 'About' },
  ]);

  const onReorder = ({ previousIndex, currentIndex }: DropEvent): void => {
    const next = nodes().slice();
    const [moved] = next.splice(previousIndex, 1);
    next.splice(currentIndex, 0, moved);
    nodes.set(next);
  };

  return { nodes, onReorder };
}
