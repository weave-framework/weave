import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Node {
  label: string;
  icon: string;
  children?: Node[];
}
interface Setup {
  nodes: Node[];
  node: (n: Node, level: number) => globalThis.Node;
}

/**
 * The `node` factory takes over a row's content entirely (it wins over `label`). It's called
 * with the node + its 1-based level and returns a DOM `Node` — here an emoji icon followed by
 * the label, so each row shows a per-node glyph.
 */
export function setup(): Setup {
  const nodes: Node[] = [
    {
      label: 'src',
      icon: '📁',
      children: [
        { label: 'button.ts', icon: '📄' },
        { label: 'styles.scss', icon: '🎨' },
      ],
    },
    { label: 'README.md', icon: '📘' },
  ];

  const node = (n: Node): globalThis.Node => {
    const row = document.createElement('span');
    row.style.display = 'inline-flex';
    row.style.gap = '6px';
    const icon = document.createElement('span');
    icon.textContent = n.icon;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = n.label;
    row.append(icon, text);
    return row;
  };

  return { nodes, node };
}
