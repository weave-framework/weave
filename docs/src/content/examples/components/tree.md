# Tree — examples

Every feature of `<Tree>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Tree reference page](/ui/tree); this page is just the examples,
covering the full component surface.

```ts
import Tree from '@weave-framework/ui/tree';
```
```scss
@use 'pkg:@weave-framework/ui/tree';
```

## Nested model (default)

Roots with a `children` array; the `label` accessor reads `node.label`. Expansion is uncontrolled with
`defaultExpanded` — pass the branch nodes that start open.

:::demo ex-tree-nested

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} defaultExpanded={{ [nodes[0]] }} />
~~~
~~~ts title="app.ts"
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { label: 'src', children: [
      { label: 'components', children: [{ label: 'button.ts' }, { label: 'input.ts' }] },
      { label: 'main.ts' },
    ]},
    { label: 'package.json' },
  ];
  return { nodes };
}
~~~
:::

## Controlled expansion

When you pass `expanded`, it becomes the source of truth; `onExpandedChange` reports the next set on
every toggle. Owning the set lets the app drive Expand-all / Collapse-all buttons.

:::demo ex-tree-controlled

:::tabs
~~~html title="app.html"
<button type="button" on:click={{ expandAll }}>Expand all</button>
<button type="button" on:click={{ collapseAll }}>Collapse all</button>

<Tree nodes={{ nodes }} expanded={{ expanded() }} onExpandedChange={{ onExpandedChange }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { label: 'src', children: [{ label: 'app', children: [{ label: 'main.ts' }] }, { label: 'index.ts' }] },
    { label: 'docs', children: [{ label: 'guide.md' }] },
  ];
  const branches = [nodes[0], nodes[0].children[0], nodes[1]];
  const expanded = signal([nodes[0]]);
  return {
    nodes,
    expanded,
    onExpandedChange: (next) => expanded.set(next),
    expandAll: () => expanded.set(branches),
    collapseAll: () => expanded.set([]),
  };
}
~~~
:::

## Selection — single

`selectable` with the default `selectionMode={{ 'single' }}` marks one node with the accent tint + left
border (the same mark as [List](/ui/list)). `onSelectionChange` reports the selection.

:::demo ex-tree-selection-single

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} selectable={{ true }} defaultExpanded={{ [nodes[0]] }} onSelectionChange={{ onSelectionChange }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [/* … */];
  const sel = signal('(none)');
  return { nodes, onSelectionChange: (s) => sel.set(s[0]?.label ?? '(none)'), picked: sel };
}
~~~
:::

## Selection — multiple

`selectionMode={{ 'multiple' }}` makes each click toggle a node in or out of the set, so several rows stay
selected at once. `onSelectionChange` reports the full set.

:::demo ex-tree-selection-multiple

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} selectable={{ true }} selectionMode={{ 'multiple' }} defaultExpanded={{ [nodes[0]] }} onSelectionChange={{ onSelectionChange }} />
~~~
:::

## Custom field accessors

Point `label`, `children`, and `trackBy` at your own fields when they aren't named `label` / `children`.
`trackBy` gives each node a stable identity for row keys and selection/expansion.

:::demo ex-tree-accessors

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} label={{ label }} children={{ children }} trackBy={{ trackBy }} selectable={{ true }} defaultExpanded={{ [nodes[0]] }} />
~~~
~~~ts title="app.ts"
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { id: 1, name: 'Fruit', items: [
      { id: 2, name: 'Citrus', items: [{ id: 3, name: 'Orange' }, { id: 4, name: 'Lemon' }] },
      { id: 5, name: 'Apple' },
    ]},
    { id: 6, name: 'Vegetable', items: [{ id: 7, name: 'Carrot' }] },
  ];
  return { nodes, label: (c) => c.name, children: (c) => c.items, trackBy: (c) => c.id };
}
~~~
:::

## Custom node content

The `node` factory takes over a row's content entirely (it wins over `label`). It's called with the node
plus its 1-based level and returns a DOM `Node` — here an emoji icon followed by the label.

:::demo ex-tree-node-content

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} node={{ node }} defaultExpanded={{ [nodes[0]] }} />
~~~
~~~ts title="app.ts"
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { label: 'src', icon: '📁', children: [
      { label: 'button.ts', icon: '📄' }, { label: 'styles.scss', icon: '🎨' },
    ]},
    { label: 'README.md', icon: '📘' },
  ];
  const node = (n) => {
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
~~~
:::

## Flat model

For big trees you may already keep a DFS-ordered array with a depth per node. Passing `getLevel` (0-based
depth) switches Tree to the flat model — it hides descendants of collapsed nodes in a single scan.

:::demo ex-tree-flat

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} getLevel={{ getLevel }} selectable={{ true }} defaultExpanded={{ [nodes[0], nodes[1]] }} />
~~~
~~~ts title="app.ts"
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { label: 'src', depth: 0 },
    { label: 'components', depth: 1 },
    { label: 'button.ts', depth: 2 },
    { label: 'input.ts', depth: 2 },
    { label: 'main.ts', depth: 1 },
    { label: 'package.json', depth: 0 },
  ];
  return { nodes, getLevel: (n) => n.depth };
}
~~~
:::

## Custom expandability

`isExpandable` overrides the default ("has children"). Return `true` to show the chevron on a node with
no loaded children yet — the classic lazy-loading folder — or `false` to force a node to render as a leaf.

:::demo ex-tree-expandable

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} isExpandable={{ isExpandable }} defaultExpanded={{ [nodes[0]] }} />
~~~
~~~ts title="app.ts"
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = [
    { label: 'Loaded', children: [{ label: 'child.ts' }] },
    { label: 'Lazy (not loaded yet)', loadsLazily: true },
    { label: 'Plain leaf' },
  ];
  return { nodes, isExpandable: (n) => n.loadsLazily === true || (n.children?.length ?? 0) > 0 };
}
~~~
:::

## Reorderable

`reorderable` adds a per-node drag handle (a lucide `grip-vertical` icon). On a committed drag Tree emits
`onReorder` with indices
over the visible order; the consumer applies it to its own model (node clicks still select / expand).

:::demo ex-tree-reorderable

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes() }} reorderable={{ true }} onReorder={{ onReorder }} ariaLabel={{ 'Navigation order' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Tree from '@weave-framework/ui/tree';

export function setup() {
  const nodes = signal([{ label: 'Home' }, { label: 'Docs' }, { label: 'Blog' }, { label: 'About' }]);
  const onReorder = ({ previousIndex, currentIndex }) => {
    const next = nodes().slice();
    const [moved] = next.splice(previousIndex, 1);
    next.splice(currentIndex, 0, moved);
    nodes.set(next);
  };
  return { nodes, onReorder };
}
~~~
:::

## Accessible name + class

`ariaLabel` names the tree for assistive tech (it becomes `aria-label` on `role="tree"`), and `class`
forwards extra classes onto the container so you can scope your own styles.

:::demo ex-tree-labelled

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} ariaLabel={{ 'Documentation outline' }} class={{ 'docs-outline' }} selectable={{ true }} defaultExpanded={{ nodes }} />
~~~
:::
