import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface FlatNode {
  label: string;
  depth: number;
}
interface Setup {
  nodes: FlatNode[];
  getLevel: (n: FlatNode) => number;
}

/**
 * The flat model: pass a DFS-ordered array plus `getLevel` (0-based depth). Providing
 * `getLevel` switches Tree to flat mode — it hides descendants of collapsed nodes in a single
 * scan, so it scales to large trees you already keep flat.
 */
export function setup(): Setup {
  const nodes: FlatNode[] = [
    { label: 'src', depth: 0 },
    { label: 'components', depth: 1 },
    { label: 'button.ts', depth: 2 },
    { label: 'input.ts', depth: 2 },
    { label: 'main.ts', depth: 1 },
    { label: 'package.json', depth: 0 },
  ];
  return { nodes, getLevel: (n) => n.depth };
}
