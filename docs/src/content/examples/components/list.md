# List — examples

Every feature of `<List>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [List reference page](/ui/list); this page is just the examples,
covering the full component surface.

```ts
import List from '@weave-framework/ui/list';
```
```scss
@use '@weave-framework/ui/list';
```

## Basic — items + value + onChange

A selectable list is a `role="listbox"`. Describe the rows as data — each `{ value, title }` — and bind
the selected key two-way with `value` + `onChange`. `label` gives the list its accessible name.

:::demo ex-list-basic

:::tabs
~~~html title="app.html"
<List items={{ items }} value={{ sel() }} onChange={{ setSel }} label={{ 'Folders' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';

export function setup() {
  const sel = signal('inbox');
  const items = [
    { value: 'inbox', title: 'Inbox' },
    { value: 'starred', title: 'Starred' },
    { value: 'sent', title: 'Sent' },
    { value: 'drafts', title: 'Drafts' },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
~~~
:::

## Trailing meta

Each item's optional `meta` is quiet trailing text — a count, a size, a timestamp — shown muted at the
end of the row.

:::demo ex-list-meta

:::tabs
~~~html title="app.html"
<List items={{ items }} value={{ sel() }} onChange={{ setSel }} label={{ 'Mailboxes' }} />
~~~
~~~ts title="app.ts"
const items = [
  { value: 'inbox', title: 'Inbox', meta: '12' },
  { value: 'starred', title: 'Starred', meta: '3' },
  { value: 'sent', title: 'Sent', meta: '128' },
  { value: 'archive', title: 'Archive', meta: '1.2k' },
];
~~~
:::

## Disabled row

Set `disabled` on a single item to skip it in keyboard navigation and block its selection — the rest of
the list stays interactive.

:::demo ex-list-disabled-row

:::tabs
~~~html title="app.html"
<List items={{ items }} value={{ sel() }} onChange={{ setSel }} label={{ 'Folders' }} />
~~~
~~~ts title="app.ts"
const items = [
  { value: 'inbox', title: 'Inbox', meta: '12' },
  { value: 'starred', title: 'Starred', meta: '3' },
  { value: 'sent', title: 'Sent' },
  { value: 'trash', title: 'Trash', disabled: true },
];
~~~
:::

## Plain (non-selectable) list

`selectable={{ false }}` renders a plain semantic `role="list"` — no selection, no roving tab stop, no
keyboard capture. Just rows of content.

:::demo ex-list-plain

:::tabs
~~~html title="app.html"
<List items={{ items }} selectable={{ false }} label={{ 'Features' }} />
~~~
~~~ts title="app.ts"
const items = [
  { value: 'a', title: 'Signal-native rendering' },
  { value: 'b', title: 'Zero runtime dependencies' },
  { value: 'c', title: 'Compiled templates', meta: 'AOT' },
  { value: 'd', title: 'First-class forms' },
];
~~~
:::

## Disabled list

`disabled` on the list itself dims every row and blocks all selection in one go.

:::demo ex-list-disabled

:::tabs
~~~html title="app.html"
<List items={{ items }} value={{ sel() }} onChange={{ setSel }} disabled={{ true }} label={{ 'Folders (disabled)' }} />
~~~
:::

## Custom class

`class` is forwarded straight onto the container, so you can hook your own styles off it — here a border
and rounded corners.

:::demo ex-list-class

:::tabs
~~~html title="app.html"
<List items={{ items }} value={{ sel() }} onChange={{ setSel }} class={{ 'my-list' }} label={{ 'Schedule' }} />
~~~
~~~scss title="app.scss"
.my-list { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
~~~
:::

## Reorderable — drag to sort

`reorderable` shows a per-row drag handle; `onReorder` fires with `{ previousIndex, currentIndex }` on a
committed drop. The list is controlled, so you reorder `items` yourself with `moveItemInArray`. Row-body
clicks still select — only the handle drags.

:::demo ex-list-reorderable

:::tabs
~~~html title="app.html"
<List items={{ items() }} value={{ sel() }} onChange={{ setSel }} reorderable={{ true }} onReorder={{ onReorder }} label={{ 'Reorderable list' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';
import { moveItemInArray, type DropEvent } from '@weave-framework/ui/cdk';

export function setup() {
  const sel = signal('a');
  const items = signal([
    { value: 'a', title: 'First', meta: '↕' },
    { value: 'b', title: 'Second', meta: '↕' },
    { value: 'c', title: 'Third', meta: '↕' },
    { value: 'd', title: 'Fourth', meta: '↕' },
  ]);
  const onReorder = ({ previousIndex, currentIndex }: DropEvent) =>
    items.set(moveItemInArray(items(), previousIndex, currentIndex));
  return { items, sel, setSel: (v) => sel.set(v), onReorder };
}
~~~
:::
