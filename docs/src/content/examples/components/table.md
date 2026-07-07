# Table — examples

Every feature of `<Table>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Table reference page](/ui/table); this page is just the examples,
covering the full component surface.

```ts
import Table from '@weave-framework/ui/table';
```
```scss
@use '@weave-framework/ui/table';
```

## Basic — columns + dataSource

Give it `columns` (a definition each — `{ key, header?, cell? }`) and a `dataSource` (a plain array, a
signal of an array, or a CDK `DataSource`). `trackBy` gives each row a stable identity; a `numeric` column
right-aligns with tabular numerals.

:::demo ex-table-basic

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
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
    { key: 'commits', header: 'Commits', numeric: true },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
~~~
:::

## Sorting — sortable + sort/onSort + compare

Mark columns `sortable` and the header becomes a button that cycles asc → desc → none (an accent arrow
marks the active one). For an array/signal source you get client-side sorting for free; bind `sort` +
`onSort` to control it. A custom `compare` overrides the default value sort, and `disableClear` keeps it
asc ↔ desc.

:::demo ex-table-sorting

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} sort={{ sort() }} onSort={{ setSort }} disableClear={{ true }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', commits: 128 },
    { id: 2, name: 'Rūta', commits: 74 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true, compare: (a, b) => a.name.length - b.name.length },
    { key: 'commits', header: 'Commits', numeric: true, sortable: true },
  ];
  const sort = signal({ active: 'commits', direction: 'desc' });
  return { rows, columns, trackBy: (r) => r.id, sort, setSort: (s) => sort.set(s) };
}
~~~
:::

## Selection — multiple

`selectable` adds a leading checkbox column (composing the real [Checkbox](/ui/checkbox)) with a tri-state
header select-all. `selectionMode="multiple"` allows many rows; `onSelectionChange` reports the selected
rows.

:::demo ex-table-selection

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} selectable={{ true }} selectionMode={{ 'multiple' }} onSelectionChange={{ onSel }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

void Checkbox; // Table composes the real <Checkbox> for its selection column

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', role: 'Lead' },
    { id: 2, name: 'Rūta', role: 'Design' },
  ];
  const columns = [{ key: 'name', header: 'Name' }, { key: 'role', header: 'Role' }];
  const count = signal(0);
  return { rows, columns, trackBy: (r) => r.id, count, onSel: (selected) => count.set(selected.length) };
}
~~~
:::

## Selection — single

`selectionMode="single"` replaces the previous pick on each click and drops the header select-all.

:::demo ex-table-single-select

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} selectable={{ true }} selectionMode={{ 'single' }} onSelectionChange={{ onSel }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

void Checkbox;

export function setup() {
  const rows = [{ id: 1, name: 'Aidas', role: 'Lead' }, { id: 2, name: 'Rūta', role: 'Design' }];
  const columns = [{ key: 'name', header: 'Name' }, { key: 'role', header: 'Role' }];
  const picked = signal('(none)');
  return { rows, columns, trackBy: (r) => r.id, picked, onSel: (s) => picked.set(s[0]?.name ?? '(none)') };
}
~~~
:::

## Custom cells — header & cell nodes + align

A column's `header` and `cell` can each be a node factory (`() => Node` / `(row) => Node`) instead of
plain text — return any DOM node. `align` (`'start' | 'center' | 'end'`) sets the cell text alignment.

:::demo ex-table-custom-cells

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} trackBy={{ trackBy }} />
~~~
~~~ts title="app.ts"
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', status: 'active', score: 128 },
    { id: 2, name: 'Rūta', status: 'away', score: 74 },
  ];
  const pill = (row) => {
    const span = document.createElement('span');
    span.textContent = row.status === 'active' ? 'Active' : 'Away';
    return span;
  };
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'status', header: () => document.createTextNode('Status'), cell: pill, align: 'center' },
    { key: 'score', header: 'Score', numeric: true },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
~~~
:::

## Expandable rows — expandable + detail

`expandable` adds a chevron column; `detail={{ (row) => … }}` renders a full-width row under the expanded
one.

:::demo ex-table-expandable

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} trackBy={{ trackBy }} expandable={{ true }} detail={{ detail }} />
~~~
~~~ts title="app.ts"
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', role: 'Lead', bio: 'Signals, compiler, and coffee.' },
    { id: 2, name: 'Rūta', role: 'Design', bio: 'Owns the design system tokens.' },
  ];
  const columns = [{ key: 'name', header: 'Name' }, { key: 'role', header: 'Role' }];
  return { rows, columns, trackBy: (r) => r.id, detail: (r) => r.bio };
}
~~~
:::

## Sticky columns + header — sticky + maxHeight

`sticky` (`'start' | 'end'`, needs a numeric `width`) freezes a column to an edge while the body scrolls
sideways. The header is always pinned; `maxHeight` caps the body so it scrolls vertically while the header
stays.

:::demo ex-table-sticky

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} trackBy={{ trackBy }} maxHeight={{ 180 }} />
~~~
~~~ts title="app.ts"
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', role: 'Lead', city: 'Vilnius', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', city: 'Kaunas', commits: 74 },
    // …
  ];
  const columns = [
    { key: 'name', header: 'Name', sticky: 'start', width: 120 },
    { key: 'role', header: 'Role', width: 160 },
    { key: 'city', header: 'City', width: 160 },
    { key: 'commits', header: 'Commits', numeric: true, sticky: 'end', width: 110 },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
~~~
:::

## Resizable columns — resizableColumns + columnWidths + onColumnResize

`resizableColumns` adds a drag grip to every header (per-column `resizable` + `minWidth` also work). Drag
a grip, or focus it and press Arrow keys. Bind `columnWidths` + `onColumnResize` to control the widths.

:::demo ex-table-resizable

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} resizableColumns={{ true }} columnWidths={{ widths() }} onColumnResize={{ onResize }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [{ id: 1, name: 'Aidas', role: 'Lead' }, { id: 2, name: 'Rūta', role: 'Design' }];
  const columns = [
    { key: 'name', header: 'Name', width: 160, minWidth: 80 },
    { key: 'role', header: 'Role', width: 160 },
  ];
  const widths = signal({ name: 160, role: 160 });
  const onResize = (e) => widths.set({ ...widths(), [e.key]: e.width });
  return { rows, columns, trackBy: (r) => r.id, widths, onResize };
}
~~~
:::

## Hidden columns — reactive columns signal

`hidden` drops a column from the render. When `columns` is bound to a signal it's reactive — flip the
checkbox to show or hide a column live.

:::demo ex-table-hidden

:::tabs
~~~html title="app.html"
<Checkbox checked={{ showCommits() }} onChange={{ onToggle }} label={{ 'Show Commits column' }} />
<Table columns={{ columns() }} dataSource={{ rows }} trackBy={{ trackBy }} />
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

void Checkbox;

export function setup() {
  const rows = [
    { id: 1, name: 'Aidas', role: 'Lead', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', commits: 74 },
  ];
  const showCommits = signal(true);
  const columns = computed(() => [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
    { key: 'commits', header: 'Commits', numeric: true, hidden: !showCommits() },
  ]);
  return { rows, columns, trackBy: (r) => r.id, showCommits, onToggle: (c) => showCommits.set(c) };
}
~~~
:::

## Empty state — emptyText + class

An empty `dataSource` renders a single full-width row with `emptyText`. `class` adds your own hook to the
root.

:::demo ex-table-empty

:::tabs
~~~html title="app.html"
<Table columns={{ columns }} dataSource={{ rows }} emptyText={{ 'No teammates yet' }} class={{ 'demo-empty' }} />
~~~
~~~ts title="app.ts"
import Table from '@weave-framework/ui/table';

export function setup() {
  const rows = [];
  const columns = [{ key: 'name', header: 'Name' }, { key: 'role', header: 'Role' }];
  return { rows, columns };
}
~~~
:::
