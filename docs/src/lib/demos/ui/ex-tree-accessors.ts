import Tree from '@weave-framework/ui/tree';

// Capitalized tags in the template resolve to this import.
void Tree;

interface Category {
  id: number;
  name: string;
  items?: Category[];
}
interface Setup {
  nodes: Category[];
  label: (c: Category) => string;
  children: (c: Category) => Category[] | undefined;
  trackBy: (c: Category) => number;
}

/**
 * Point `label`, `children`, and `trackBy` at your own fields when they aren't named
 * `label` / `children`. `trackBy` gives each node a stable identity for row keys and
 * selection/expansion.
 */
export function setup(): Setup {
  const nodes: Category[] = [
    {
      id: 1,
      name: 'Fruit',
      items: [
        { id: 2, name: 'Citrus', items: [{ id: 3, name: 'Orange' }, { id: 4, name: 'Lemon' }] },
        { id: 5, name: 'Apple' },
      ],
    },
    { id: 6, name: 'Vegetable', items: [{ id: 7, name: 'Carrot' }] },
  ];
  return {
    nodes,
    label: (c) => c.name,
    children: (c) => c.items,
    trackBy: (c) => c.id,
  };
}
