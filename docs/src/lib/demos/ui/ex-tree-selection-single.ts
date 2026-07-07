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
 * `selectable` with the default `selectionMode="single"`: clicking (or Enter / Space) marks
 * one node with the accent tint + left border. `onSelectionChange` reports the selection.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    {
      label: 'src',
      children: [
        { label: 'components', children: [{ label: 'button.ts' }, { label: 'input.ts' }] },
        { label: 'main.ts' },
      ],
    },
    { label: 'package.json' },
  ];
  const sel = signal('(none)');
  return {
    nodes,
    onSelectionChange: (selected) => sel.set(selected[0]?.label ?? '(none)'),
    picked: sel,
  };
}
