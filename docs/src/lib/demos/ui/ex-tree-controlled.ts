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
  expanded: () => Node[];
  onExpandedChange: (next: Node[]) => void;
  expandAll: () => void;
  collapseAll: () => void;
  count: () => number;
}

/**
 * Controlled expansion: `expanded` is the source of truth, `onExpandedChange` reports the
 * next set on every toggle. Owning the set lets the app drive Expand-all / Collapse-all.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    { label: 'src', children: [{ label: 'app', children: [{ label: 'main.ts' }] }, { label: 'index.ts' }] },
    { label: 'docs', children: [{ label: 'guide.md' }] },
  ];
  const branches: Node[] = [nodes[0], nodes[0].children![0], nodes[1]];

  const expanded = signal<Node[]>([nodes[0]]);
  return {
    nodes,
    expanded,
    onExpandedChange: (next) => expanded.set(next),
    expandAll: () => expanded.set(branches),
    collapseAll: () => expanded.set([]),
    count: () => expanded().length,
  };
}
