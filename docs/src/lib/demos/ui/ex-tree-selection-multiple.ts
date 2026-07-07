import { signal } from '@weave-framework/runtime';
import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Node {
  label: string;
  children?: Node[];
}
interface Setup {
  nodes: Node[];
  onSelectionChange: (selected: Node[]) => void;
  picked: () => string;
}

/**
 * `selectionMode="multiple"`: each click toggles a node in or out of the set, so several rows
 * stay selected at once. `onSelectionChange` reports the full selected set.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    {
      label: 'src',
      children: [{ label: 'button.ts' }, { label: 'input.ts' }, { label: 'main.ts' }],
    },
    { label: 'package.json' },
  ];
  const sel = signal('(none)');
  return {
    nodes,
    onSelectionChange: (selected) => sel.set(selected.map((n) => n.label).join(', ') || '(none)'),
    picked: sel,
  };
}
