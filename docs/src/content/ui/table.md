# Table

A real data table — a native `<table>` driven by a column definition and a data source, with sorting, row
selection, sticky columns and header, expandable detail rows, and column resizing. It's built for actual datasets,
not just layout.

:::demo table-demo

## Import

```ts
import Table from '@weave-framework/ui/table';
```

```scss
@use 'pkg:@weave-framework/ui/table';
```

## Basic usage

Give it `columns` (a column definition each) and a `dataSource` — a plain array, a signal of an array, or a CDK
`DataSource`. Each column is `{ key, header?, cell? }`; by default the cell reads `row[key]`:

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} trackBy={{ trackBy }} ariaLabel={{ 'Team' }} />
~~~
~~~ts title="app.ts"
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', role: 'Lead', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', commits: 74 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'role', header: 'Role' },
    { key: 'commits', header: 'Commits', numeric: true, sortable: true },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
~~~
:::

`trackBy` gives each row a stable identity (used for keys and selection) — pass it whenever your data can reorder.

## Columns

A `TableColumn` is where most of the power lives:

| Field | Description |
| --- | --- |
| `key` | Column id + default cell accessor (`row[key]`). |
| `header` | Header text, or a node factory. Defaults to `key`. |
| `cell` | `(row) => Node \| string` — custom cell content. |
| `sortable` | Make the header a sort button. |
| `compare` | Custom comparator for the client-side sort. |
| `numeric` | Right-align + tabular numerals. |
| `align` | `'start' \| 'center' \| 'end'`. |
| `sticky` | Freeze to `'start'` / `'end'` while scrolling (needs a numeric `width` for the offset maths). |
| `hidden` | Hide the column (reactive when `columns` is a signal). |
| `width` | Column width — `number` (px) or a CSS string. |
| `resizable` | Make just this column resizable (overrides `resizableColumns`). |
| `minWidth` | Minimum width (px) when resizing. Defaults to `48`. |

## Sorting

Mark columns `sortable` and click the header to cycle asc → desc → none (an accent arrow shows the active one). For
an array/signal source you get **client-side sorting for free**; for a custom `DataSource`, listen to `onSort` and
sort your data:

```html
<Table columns={{ columns }} dataSource={{ rows }} sort={{ sort() }} onSort={{ setSort }} />
```

Set `disableClear` to cycle asc → desc → asc (never back to unsorted), and `clientSort={{ false }}` to turn off the
built-in sort for an array/signal source when you'd rather sort the data yourself from `onSort`.

## Selection

`selectable={{ true }}` adds a leading checkbox column (composing the real [Checkbox](/ui/checkbox)).
`selectionMode` defaults to `'multiple'`; set `'single'` for one-at-a-time. In multiple mode the header carries a
tri-state select-all — click it to select or clear every row. `onSelectionChange` reports the selected rows:

```html
<Table columns={{ columns }} dataSource={{ rows }} selectable={{ true }} selectionMode={{ 'multiple' }} onSelectionChange={{ onSel }} />
```

## Beyond the basics

- **Sticky** — `sticky` on any column (or the sticky header, always pinned) with a `maxHeight` on the body.
- **Expandable rows** — `expandable={{ true }}` + `detail={{ (row) => … }}` adds a leading disclosure toggle per
  row and renders a full-width detail row under the expanded one.
- **Resizable** — `resizableColumns={{ true }}` (or per-column `resizable`) adds a drag grip on each header;
  `onColumnResize` reports the new width. The grip is a focusable `role="separator"`, so **Arrow Left / Right**
  resize from the keyboard too. Pass `columnWidths` to control the widths yourself.
- **`maxHeight`** — cap the body height and it scrolls vertically while the header stays put.
- **Per-column filters** — `headerRow={{ (col) => … }}` renders a **second row inside `<thead>`**, directly
  under the column headers, one cell per visible column (return `null` for a column that gets no control):

  ~~~html
  <Table columns={{ cols }} dataSource={{ rows }}
         headerRow={{ (col) => filterInputFor(col) }} />
  ~~~

  Each cell inherits its header's width, alignment and sticky treatment, and pins under the header when the
  body scrolls. It belongs inside `<thead>` for a concrete reason: a filter row rendered as a sibling above
  the table only lines up while *every* column has an explicit width — the moment one auto-sizes, the two
  drift apart.
- **Virtual body** — `virtual` renders only the rows in view (plus overscan) instead of the whole page:

  ~~~html
  <Table columns={{ cols }} dataSource={{ rows }}
         maxHeight={{ 480 }} virtual rowHeight={{ 34 }} />
  ~~~

  First render of a large page is what this removes — the cost is linear in cells, so a thousand rows of
  twenty columns is ~21 000 cells and hundreds of milliseconds, while a viewport holds 20–40 rows however
  long the data is. (Re-sorting is already cheap without it: `trackBy` moves the existing DOM.)

  It needs `maxHeight` — without one the box grows to fit and there is no viewport to window — and a
  **uniform row height**: the fixed-size strategy maps scroll position to a row index arithmetically, so
  `rowHeight` must match what a row actually renders at. For the same reason `expandable` is not compatible,
  and the combination is reported rather than left to drift. Selection, select-all and the empty state still
  read the whole data set; only the rendered rows are windowed, and the table carries `aria-rowcount` with
  each row's true `aria-rowindex` so a screen reader is told what it cannot see.

## Accessibility

It's a real `<table>` with `<thead>` / `<tbody>` / `<th scope="col">`, so structure and navigation are native.
Sortable headers are buttons with `aria-sort`; selected rows carry `aria-selected`; the select-all is a real
tri-state checkbox. Name the table with `ariaLabel`.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `columns` | `TableColumn<T>[]` | — | The column definitions. |
| `dataSource` | `DataSource<T> \| T[] \| Signal<T[]>` | — | The rows. |
| `trackBy` | `(row: T) => string \| number` | *(object identity)* | Stable row identity. |
| `sort` / `onSort` | `SortState` / `(sort: SortState) => void` | — | Controlled sort state + change handler. |
| `disableClear` | `boolean` | `false` | Cycle asc → desc → asc instead of clearing the sort. |
| `clientSort` | `boolean` | `true` | Set `false` to skip the built-in sort for array/signal sources. |
| `selectable` | `boolean` | `false` | Add a selection checkbox column. |
| `selectionMode` | `'single' \| 'multiple'` | `'multiple'` | Selection cardinality (the select-all only shows in multiple). |
| `selection` | `SelectionModel<T>` | *(created)* | Bring your own CDK selection model. |
| `onSelectionChange` | `(selected: T[]) => void` | — | Called with the selected rows. |
| `compareWith` | `(a: T, b: T) => boolean` | `===` | Identity comparator for selection + expansion. |
| `expandable` / `detail` | `boolean` / `(row: T) => Node \| string` | — | Expandable detail rows. |
| `headerRow` | `(col: TableColumn<T>) => Node \| null` | — | A second `<thead>` row under the headers — the per-column filter slot. |
| `maxHeight` | `number \| string` | — | Cap the body height (it scrolls; header stays). |
| `virtual` | `boolean` | `false` | Render only the rows in view. Needs `maxHeight` + a uniform row height; not compatible with `expandable`. |
| `rowHeight` | `number` | `34` | Row height (px) the virtual window assumes — must match what a row renders at. |
| `overscan` | `number` | `6` | Rows kept rendered above and below the viewport in `virtual` mode. |
| `resizableColumns` | `boolean` | `false` | Make every column resizable. |
| `columnWidths` | `Record<string, number>` | — | Controlled column widths (px), keyed by column key. |
| `onColumnResize` | `(event: ColumnResize) => void` | — | Called after a resize with `{ key, width }`. |
| `ariaLabel` | `string` | — | Accessible name for the table. |
| `emptyText` | `string` | `'No data'` | Shown when there are no rows. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

## When it goes wrong

Two of these are **build-time refusals** rather than bad rendering, and both are refusals on purpose:
the alternative is a table that shows the wrong rows.

:::callout trap "`virtual` needs `maxHeight`"
~~~
weave Table: `virtual` needs `maxHeight` — without one the body has no viewport to window.
~~~

A virtual body renders only the rows inside a scrolling window. Without a height the box grows to fit
its content, so there is no window and nothing to virtualize. Give it a `maxHeight`, or drop `virtual`.
:::

**`virtual` and `expandable` together.**

~~~
weave Table: `virtual` and `expandable` are not compatible — the fixed-size window maps scroll
position to a row index, and a detail row of unknown height breaks that mapping. Render the
detail in a dialog or a side panel, or drop `virtual`.
~~~

The message names the fix because there are two good ones. This is refused rather than approximated: a
detail row of unknown height would not merely misplace the scrollbar, it would show the **wrong rows**.

**Sorting that does nothing.** A column sorts on its `key` by default. A column whose value is derived,
or is an object, needs a `compare` — without one there is nothing sensible to order by and the rows stay
as they were.

**Rows that re-render when they should not.** Give `@for` over your rows a stable `track`. A row keyed by
index is a different row every time the list is filtered.
