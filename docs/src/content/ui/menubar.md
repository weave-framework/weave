# Menubar

The classic application menu bar — a row of top-level menus (File / Edit / View) that each drop down. Where a
single [Menu](/ui/menu) hides behind its trigger, the bar stays visible and you move between its menus with the
arrow keys. Each dropdown is that same Menu panel, so items behave identically.

:::demo menubar-demo

## Import

```ts
import Menubar from '@weave-framework/ui/menubar';
```

```scss
@use 'pkg:@weave-framework/ui/menubar';
```

## Basic usage

Describe the bar as data — each top menu is `{ label, items }` — and handle picks with `onSelect`:

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'Main menu' }} />
~~~
~~~ts title="app.ts"
import Menubar from '@weave-framework/ui/menubar';

export function setup() {
  const menus = [
    { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'save', label: 'Save' }] },
    { label: 'Edit', items: [{ value: 'undo', label: 'Undo' }, { value: 'redo', label: 'Redo' }] },
    { label: 'View', items: [{ value: 'zoom-in', label: 'Zoom in' }] },
  ];
  const onSelect = (v) => { /* the chosen item's value */ };
  return { menus, onSelect };
}
~~~
:::

Menu items use the same shape as [Menu](/ui/menu) (`value` / `label` / `divider` / `disabled` …). A top-level menu
can carry `disabled: true` of its own to grey out the whole entry.

## Accessibility

It's the APG menubar pattern: `role="menubar"` of top items, each opening the shared `role="menu"`. **Left / Right**
move between top menus (wrapping, skipping disabled, one roving tab stop), **Home / End** jump to the ends, and
typeahead matches a top label; **↓ / Enter / Space** open the focused menu on its first item; while a menu is open,
Left / Right switch to the neighbouring menu; Esc closes and returns focus to its top item. Give the bar a `label`
for its accessible name.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `menus` | `MenubarMenu[]` | — | The top-level menus, left to right, each `{ label, items, disabled? }`. |
| `onSelect` | `(value: string \| MenuItem) => void` | — | Called with the chosen item's value (or the whole item object). |
| `label` | `string` | — | Accessible name for the menubar. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
