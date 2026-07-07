# Menubar — examples

Every feature of `<Menubar>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Menubar reference page](/ui/menubar); this page is just the examples,
covering the full component surface.

```ts
import Menubar from '@weave-framework/ui/menubar';
```
```scss
@use '@weave-framework/ui/menubar';
```

## Basic — menus + onSelect

Describe the bar as data — each top menu is `{ label, items }` — and handle picks with `onSelect`. Give the
bar a `label` for its accessible name.

:::demo ex-menubar-basic

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'Main menu' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Menubar from '@weave-framework/ui/menubar';
import type { MenubarMenu } from '@weave-framework/ui/menubar';
import type { MenuItem } from '@weave-framework/ui/menu';

export function setup() {
  const picked = signal('');
  const menus: MenubarMenu[] = [
    { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'open', label: 'Open' }, { value: 'save', label: 'Save' }] },
    { label: 'Edit', items: [{ value: 'undo', label: 'Undo' }, { value: 'redo', label: 'Redo' }] },
    { label: 'View', items: [{ value: 'zoom-in', label: 'Zoom in' }, { value: 'zoom-out', label: 'Zoom out' }] },
  ];
  return { menus, picked, onSelect: (v: string | MenuItem) => picked.set(typeof v === 'string' ? v : v.value) };
}
~~~
:::

## Item descriptions

A `description` on an item renders as smaller, lighter subtext under the label — good for a one-line hint on
what each command does. Items share the [Menu](/ui/menu) item model.

:::demo ex-menubar-descriptions

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'File and sharing' }} />
~~~
~~~ts title="app.ts"
const menus: MenubarMenu[] = [
  {
    label: 'File',
    items: [
      { value: 'new', label: 'New file', description: 'Start with a blank document' },
      { value: 'open', label: 'Open…', description: 'Browse for an existing file' },
      { value: 'save', label: 'Save', description: 'Write changes to disk' },
    ],
  },
  {
    label: 'Share',
    items: [
      { value: 'link', label: 'Copy link', description: 'Anyone with the link can view' },
      { value: 'invite', label: 'Invite people', description: 'Send an email invitation' },
    ],
  },
];
~~~
:::

## Dividers

An item with `divider: true` renders a hairline separator instead of a row — use it to group related
commands inside a dropdown.

:::demo ex-menubar-dividers

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'File menu' }} />
~~~
~~~ts title="app.ts"
const menus: MenubarMenu[] = [
  {
    label: 'File',
    items: [
      { value: 'new', label: 'New' },
      { value: 'open', label: 'Open' },
      { value: 'sep-1', label: '', divider: true },
      { value: 'save', label: 'Save' },
      { value: 'save-as', label: 'Save as…' },
      { value: 'sep-2', label: '', divider: true },
      { value: 'close', label: 'Close' },
    ],
  },
];
~~~
:::

## Disabled items

An item with `disabled: true` is greyed, unselectable, and skipped by keyboard navigation inside the
dropdown.

:::demo ex-menubar-disabled-items

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'Edit menu' }} />
~~~
~~~ts title="app.ts"
const menus: MenubarMenu[] = [
  {
    label: 'Edit',
    items: [
      { value: 'undo', label: 'Undo' },
      { value: 'redo', label: 'Redo', disabled: true },
      { value: 'sep', label: '', divider: true },
      { value: 'cut', label: 'Cut' },
      { value: 'copy', label: 'Copy' },
      { value: 'paste', label: 'Paste', disabled: true },
    ],
  },
];
~~~
:::

## Disabled top menu

`disabled: true` on a whole top menu greys the button out and skips it as you rove Left/Right across the
bar — it can't be opened.

:::demo ex-menubar-disabled-menu

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'Main menu' }} />
~~~
~~~ts title="app.ts"
const menus: MenubarMenu[] = [
  { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'open', label: 'Open' }] },
  { label: 'Edit', items: [{ value: 'undo', label: 'Undo' }], disabled: true },
  { label: 'View', items: [{ value: 'zoom-in', label: 'Zoom in' }, { value: 'zoom-out', label: 'Zoom out' }] },
];
~~~
:::

## Reacting to the pick

`onSelect` fires with the chosen item's `value` string. Because the menus are your own data, you can look
the value back up to recover the full item — its label, description, anything you stored on it.

:::demo ex-menubar-select-object

:::tabs
~~~html title="app.html"
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'Insert menu' }} />
~~~
~~~ts title="app.ts"
export function setup() {
  const readout = signal('');
  const menus: MenubarMenu[] = [
    {
      label: 'Insert',
      items: [
        { value: 'image', label: 'Image', description: 'From your device' },
        { value: 'table', label: 'Table', description: 'Rows and columns' },
        { value: 'chart', label: 'Chart', description: 'Bar, line or pie' },
      ],
    },
  ];
  const byValue = new Map(menus[0].items.map((it) => [it.value, it] as const));
  const onSelect = (v: string | MenuItem) => {
    const value = typeof v === 'string' ? v : v.value;
    const it = byValue.get(value);
    readout.set(it ? `${it.label} — ${it.description ?? ''} (value: ${it.value})` : value);
  };
  return { menus, readout, onSelect };
}
~~~
:::

## Custom class

`class` is forwarded onto the `role="menubar"` container, so you can theme or frame the whole bar from your
own stylesheet.

:::demo ex-menubar-class

:::tabs
~~~html title="app.html"
<style>
  .app-bar {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px 6px;
    background: var(--bg-subtle);
  }
</style>
<Menubar menus={{ menus }} onSelect={{ onSelect }} label={{ 'App bar' }} class={{ 'app-bar' }} />
~~~
~~~ts title="app.ts"
const menus: MenubarMenu[] = [
  { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'save', label: 'Save' }] },
  { label: 'Help', items: [{ value: 'docs', label: 'Documentation' }, { value: 'about', label: 'About' }] },
];
~~~
:::
