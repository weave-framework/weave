# List

A vertical list of rows — a nav menu, a set of options, a pick-one list. By default it's **selectable** (a proper
`role="listbox"` with keyboard); turn that off for a plain semantic list. Each row has a title and optional trailing
meta text.

:::demo list-demo

## Import

```ts
import List from '@weave-framework/ui/list';
```

```scss
@use 'pkg:@weave-framework/ui/list';
```

## Basic usage

Describe the rows as data — each `{ value, title, meta? }` — and bind the selected key with `value` + `onChange`:

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
    { value: 'inbox', title: 'Inbox', meta: '12' },
    { value: 'starred', title: 'Starred', meta: '3' },
    { value: 'sent', title: 'Sent' },
    { value: 'trash', title: 'Trash', disabled: true },
  ];
  return { items, sel, setSel: (v) => sel.set(v) };
}
~~~
:::

`meta` is quiet trailing text (a count, a timestamp); `disabled` skips a row in keyboard nav and selection.

## Plain (non-selectable) list

Set `selectable={{ false }}` for a semantic list with no selection or keyboard focus — just rows of content:

```html
<List items={{ items }} selectable={{ false }} />
```

## Accessibility

Selectable, it's a `role="listbox"` of `role="option"` rows with `aria-selected`, a single roving tab stop, and
**Up / Down / Home / End** navigation (wrapping, skipping disabled) plus typeahead on the row `title`; Enter /
Space / click selects. Give it a
`label` for its accessible name. Non-selectable, it's a plain `role="list"`.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `ListItem<T>[]` | — | The rows, each `{ value, title, meta?, disabled?, data? }`. `data` is an arbitrary payload `rowTemplate` can read. |
| `selectable` | `boolean` | `true` | Listbox (selectable) vs a plain semantic list. |
| `value` | `string \| null` | — | Controlled selected key (single-select). |
| `onChange` | `(value: string) => void` | — | Called with the next value on select. |
| `disabled` | `boolean` | `false` | Disable the whole list (every row is skipped by keyboard nav and not selectable). |
| `reorderable` | `boolean` | `false` | Show a per-row drag handle (a lucide `grip-vertical` Icon) and let rows be dragged to reorder. Pointer-drag only — the listbox keeps Space / arrows for selection. |
| `onReorder` | `(event: DropEvent) => void` | — | Called on a committed reorder with `{ previousIndex, currentIndex }` (the list is controlled — you reorder `items`). |
| `rowTemplate` | `(row: ListRowContext<T>) => Node` | — | Renders the whole body of each row (replacing the default title + meta spans) from the row's data + state. See below. |
| `label` | `string` | — | Accessible name for the list. |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### `rowTemplate` — custom row content

Pass an authored `@snippet` as `rowTemplate` to render the whole body of each `.weave-list__row` —
a colour dot, tag pills, a muted description, trailing action buttons. The framework still owns the
row, its role, `aria-selected`, roving tabindex, keyboard nav and (when `reorderable`) the drag
handle rendered **before** the template; the template only fills the row's inner content. `title`
stays the accessible name + typeahead target, and the active row is styled via the
`[aria-selected='true']` hook. It re-renders when a row's `selected` state flips. Omit it for the
default title + meta spans — fully back-compatible. Parallels the menu's `itemTemplate` and tabs'
`tabTemplate`. See the [Custom row content example](/examples/components/list).

In *selectable* mode a click on an interactive descendant (a `button`, link or `[role="button"]`)
inside the template does not toggle row selection — it stays that control's click.

The snippet receives a `ListRowContext<T>`:

| Field | Type | Description |
| --- | --- | --- |
| `item` | `ListItem<T>` | The row's data object (bind `row.item.title`, `row.item.data.*`). |
| `value` | `string` | The row's value/key. |
| `title` | `string` | The row's title — also the accessible name + typeahead text. |
| `meta` | `string \| undefined` | The row's meta text, if any. |
| `data` | `T \| undefined` | The row's arbitrary payload (`item.data`). |
| `index` | `number` | Zero-based position in the list. |
| `selected` | `boolean` | True when this row is `aria-selected` (re-renders when it flips). |
| `disabled` | `boolean` | True when this row is disabled. |
