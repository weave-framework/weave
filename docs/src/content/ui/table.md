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
@use '@weave-framework/ui/table';
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
| `sticky` | Freeze to `'start'` / `'end'` while scrolling (needs a numeric `width`). |
| `hidden` | Hide the column (reactive when `columns` is a signal). |
| `width` | Column width (number → px). |

## Sorting

Mark columns `sortable` and click the header to cycle asc → desc → none (an accent arrow shows the active one). For
an array/signal source you get **client-side sorting for free**; for a custom `DataSource`, listen to `onSort` and
sort your data:

```html
<Table columns={{ columns }} dataSource={{ rows }} sort={{ sort() }} onSort={{ setSort }} />
```

## Selection

`selectable={{ true }}` adds a leading checkbox column (composing the real [Checkbox](/ui/checkbox)) with a header
select-all. `selectionMode` is `'single'` or `'multiple'`; `onSelectionChange` reports the selected rows. The
checkbox column is a real composed `<Checkbox>` — click the header to select or clear every row:

:::demo table-demo

```html
<Table columns={{ columns }} dataSource={{ rows }} selectable={{ true }} selectionMode={{ 'multiple' }} onSelectionChange={{ onSel }} />
```

## Beyond the basics

- **Sticky** — `sticky` on any column (or the sticky header, always pinned) with a `maxHeight` on the body.
- **Expandable rows** — `expandable={{ true }}` + `detail={{ (row) => … }}` renders a chevron and a full-width
  detail row.
- **Resizable** — `resizableColumns={{ true }}` (or per-column `resizable`) adds a drag grip on each header;
  `onColumnResize` reports the new width.
- **`maxHeight`** — cap the body height and it scrolls vertically while the header stays put.

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
| `trackBy` | `(row: T) => string \| number` | *(index)* | Stable row identity. |
| `sort` / `onSort` | `SortState` / `(s) => void` | — | Controlled sort state + change handler. |
| `selectable` | `boolean` | `false` | Add a selection checkbox column. |
| `selectionMode` | `'single' \| 'multiple'` | `'single'` | Selection cardinality. |
| `onSelectionChange` | `(selected: T[]) => void` | — | Called with the selected rows. |
| `expandable` / `detail` | `boolean` / `(row) => Node` | — | Expandable detail rows. |
| `maxHeight` | `number \| string` | — | Cap the body height (it scrolls; header stays). |
| `resizableColumns` | `boolean` | `false` | Make every column resizable. |
| `onColumnResize` | `(event: ColumnResize) => void` | — | Called after a resize. |
| `ariaLabel` | `string` | — | Accessible name for the table. |
| `emptyText` | `string` | — | Shown when there are no rows. |
