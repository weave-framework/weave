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
@use '@weave-framework/ui/tree';
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

## Accessibility

It's the WAI-ARIA `role="tree"` pattern: `role="treeitem"` rows with `aria-level` / `aria-setsize` /
`aria-posinset` / `aria-expanded` / `aria-selected`, a single roving tab stop, and the full key map — **Up / Down**
move, **Right** expands (then steps into the first child), **Left** collapses (then moves to the parent), **Home /
End** jump, **Enter / Space** activate, with typeahead.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` | `N[]` | — | Root nodes (nested) or the DFS array (flat). |
| `children` | `(node: N) => N[] \| undefined` | `node.children` | Children accessor (nested model). |
| `getLevel` | `(node: N) => number` | — | Depth accessor — its presence selects the flat model. |
| `isExpandable` | `(node: N) => boolean` | *(auto)* | Whether a node can expand. |
| `label` | `(node: N) => string` | `node.label` | Node label accessor. |
| `node` | `TreeNodeContent<N>` | — | Full node-content override (wins over `label`). |
| `trackBy` | `(node: N) => string \| number` | *(identity)* | Stable node identity. |
| `expanded` / `onExpandedChange` | `N[]` / `(e) => void` | — | Controlled expanded set. |
| `defaultExpanded` | `N[]` | — | Uncontrolled initial expanded set. |
| `selectable` | `boolean` | `false` | Enable node selection. |
| `selectionMode` | `'single' \| 'multiple'` | `'single'` | Selection cardinality. |
| `onSelectionChange` | `(selected: N[]) => void` | — | Called with the selected nodes. |
