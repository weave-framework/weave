import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Node {
  label: string;
  loadsLazily?: boolean;
  children?: Node[];
}
interface Setup {
  nodes: Node[];
  isExpandable: (n: Node) => boolean;
}

/**
 * `isExpandable` overrides the default (nested → "has children"). Return `true` to show the
 * chevron even for a node with no loaded children yet — the classic lazy-loading folder —
 * or `false` to force a node to render as a leaf.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    { label: 'Loaded', children: [{ label: 'child.ts' }] },
    { label: 'Lazy (not loaded yet)', loadsLazily: true },
    { label: 'Plain leaf' },
  ];
  return {
    nodes,
    isExpandable: (n) => n.loadsLazily === true || (n.children?.length ?? 0) > 0,
  };
}
