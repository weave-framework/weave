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

/** The nested model (default): roots with `children`; `label` reads `node.label`. */
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
  return { nodes };
}
