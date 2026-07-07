import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Node {
  label: string;
  children?: Node[];
}
interface Setup {
  nodes: Node[];
}

/**
 * `ariaLabel` names the tree for assistive tech (it becomes `aria-label` on `role="tree"`),
 * and `class` forwards extra classes onto the container so you can scope your own styles.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    { label: 'Getting started', children: [{ label: 'Install' }, { label: 'Quick start' }] },
    { label: 'Guides', children: [{ label: 'Routing' }, { label: 'Forms' }] },
  ];
  return { nodes };
}
