# Tree

A hierarchy you can expand and collapse — a file explorer, a category picker, a nested outline. `<Tree>` takes
either a **nested** model (nodes with children) or a **flat** one (a DFS-ordered array with a level accessor), and
handles expansion, selection, and full keyboard navigation.

:::demo tree-demo

## Import

```ts
import Tree from '@weave-framework/ui/tree';
```

```scss
@use 'pkg:@weave-framework/ui/tree';
```

## Nested model (default)

Pass `nodes` where each has a `children` array; the `label` accessor reads `node.label` by default. Expansion is
uncontrolled with `defaultExpanded` (or controlled with `expanded` + `onExpandedChange`):

:::tabs
~~~html title="app.html"
<Tree nodes={{ nodes }} selectable={{ true }} defaultExpanded={{ [nodes[0]] }} />
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

Point `children` and `label` at your own fields if they're named differently, or pass a `node` factory for fully
custom row content.

## Flat model

For big trees you may already have a flat, DFS-ordered array with a depth per node — pass `getLevel` and Tree uses
the flat model (hiding descendants of collapsed nodes via a single scan):

```html
<Tree nodes={{ flatNodes }} getLevel={{ (n) => n.depth }} selectable={{ true }} />
```

## Selection

`selectable={{ true }}` turns on selection (`selectionMode` `'single'` or `'multiple'`); `onSelectionChange` reports
the selected nodes. A selected node gets the accent tint + left border (the same as [List](/ui/list)).

Selection changes what a row click does: with `selectable` on, clicking a row selects it and only the disclosure
chevron expands/collapses; with it off, clicking anywhere on an expandable row toggles it.

## Reordering

`reorderable={{ true }}` gives every node a drag handle and lets you drag nodes into a new order. Tree doesn't
mutate your data — `onReorder` hands you a `DropEvent` whose indices are over the **visible** node order, and you
apply the move to your own model:

```html
<Tree nodes={{ nodes }} reorderable={{ true }} onReorder={{ onReorder }} />
```

Dragging starts from the handle only, so node clicks still select and expand, and keyboard drag is off — the tree
keeps the arrow keys for navigation.

## Accessibility

It's the WAI-ARIA `role="tree"` pattern: `role="treeitem"` rows with `aria-level` / `aria-setsize` /
`aria-posinset` / `aria-expanded` / `aria-selected`, a single roving tab stop, and the full key map — **Up / Down**
move, **Right** expands (then steps into the first child), **Left** collapses (then moves to the parent), **Home /
End** jump, **Enter / Space** activate, with typeahead. Under `dir="rtl"` the two horizontal arrows swap, so
**Left** expands and **Right** collapses.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` | `N[]` | — | Root nodes (nested) or the DFS array (flat). |
| `children` | `(node: N) => N[] \| undefined` | `node.children` | Children accessor (nested model). |
| `getLevel` | `(node: N) => number` | — | Depth accessor — its presence selects the flat model. |
| `isExpandable` | `(node: N) => boolean` | *(auto)* | Whether a node can expand. Auto = has children (nested) / the next node is deeper (flat). |
| `label` | `(node: N) => string` | `node.label` | Node label accessor — also the typeahead text. |
| `node` | `(node: N, level: number) => Node \| string` | — | Full node-content override (wins over `label`). `level` is 1-based. |
| `trackBy` | `(node: N) => string \| number` | *(identity)* | Stable node identity. |
| `expanded` / `onExpandedChange` | `N[]` / `(e) => void` | — | Controlled expanded set. |
| `defaultExpanded` | `N[]` | — | Uncontrolled initial expanded set. |
| `selectable` | `boolean` | `false` | Enable node selection. |
| `selectionMode` | `'single' \| 'multiple'` | `'single'` | Selection cardinality. |
| `selection` | `SelectionModel<N>` | *(created)* | Bring your own CDK selection model. |
| `onSelectionChange` | `(selected: N[]) => void` | — | Called with the selected nodes. |
| `compareWith` | `(a: N, b: N) => boolean` | `===` | Identity comparator for selection + expansion. |
| `reorderable` | `boolean` | `false` | Show a per-node drag handle and allow drag reordering. |
| `onReorder` | `(event: DropEvent) => void` | — | Called on a committed reorder (indices over the visible order). |
| `ariaLabel` | `string` | — | Accessible name for the tree. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
