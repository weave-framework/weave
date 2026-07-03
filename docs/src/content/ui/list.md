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
@use '@weave-framework/ui/list';
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
**Up / Down / Home / End** navigation (wrapping, skipping disabled); Enter / Space / click selects. Give it a
`label` for its accessible name. Non-selectable, it's a plain `role="list"`.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `ListItem[]` | — | The rows, each `{ value, title, meta?, disabled? }`. |
| `selectable` | `boolean` | `true` | Listbox (selectable) vs a plain semantic list. |
| `value` | `string \| null` | — | Controlled selected key (single-select). |
| `onChange` | `(value: string) => void` | — | Called with the next value on select. |
| `label` | `string` | — | Accessible name for the list. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
