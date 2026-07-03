# Menubar

The classic application menu bar — a row of top-level menus (File / Edit / View) that each drop down. Unlike a
single [Menu](/ui/menu), the bar is always visible and you move between menus with the arrow keys. Each dropdown is
the shared Menu, so items behave identically.

:::demo menubar-demo

## Import

```ts
import Menubar from '@weave-framework/ui/menubar';
```

```scss
@use '@weave-framework/ui/menubar';
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

Menu items use the same shape as [Menu](/ui/menu) (`value` / `label` / `divider` / `disabled` …).

## Accessibility

It's the APG menubar pattern: `role="menubar"` of top items, each opening the shared `role="menu"`. **Left / Right**
move between top menus (roving tab stop); **↓** opens the focused one; while a menu is open, Left / Right switch to
the neighbouring menu; Esc closes. Give the bar a `label` for its accessible name.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `menus` | `MenubarMenu[]` | — | The top-level menus, each `{ label, items }`. |
| `onSelect` | `(value: string \| MenuItem) => void` | — | Called with the chosen item's value. |
| `label` | `string` | — | Accessible name for the menubar. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
