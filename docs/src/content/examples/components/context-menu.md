# Context Menu — examples

Every feature of the `contextMenu` action, each as a live, self-contained example you can read and lift
straight into your project. The prose lives on the [Context Menu reference page](/ui/context-menu); this
page is just the examples, covering the full option surface.

`contextMenu` is a Weave **`use:` action** — attach it to the surface it should apply to. Right-click the
bordered box in each demo (or focus it and press the context-menu key / Shift+F10).

```ts
import { contextMenu } from '@weave-framework/ui/context-menu';
```
```scss
@use '@weave-framework/ui/context-menu';
```

:::callout tip "Never inline the options"
Always keep the options object in `setup()` and reference it by name. An inline object literal as a
`use:` argument (`use:contextMenu={{ { items: [...] } }}`) compiles to `() => { … }` — a JS block, so the
options are lost.
:::

## Basic — items + onSelect

The default: `items` of `{ value, label }` plus an `onSelect`. The native menu is suppressed and yours
opens at the pointer.

:::demo ex-context-menu-basic

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const picked = signal('');
  const ctxOpts = {
    items: [
      { value: 'copy', label: 'Copy' },
      { value: 'paste', label: 'Paste' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v) => picked.set(v),
  };
  return { contextMenu, ctxOpts, picked };
}
~~~
:::

## Labels, descriptions, disabled & dividers

The full default item shape: a `label`, an optional `description` subtext line, a `disabled` item (greyed
and skipped by keyboard nav), and a `divider` hairline separator between groups.

:::demo ex-context-menu-items

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const ctxOpts = {
    items: [
      { value: 'edit', label: 'Edit', description: 'Rename this item' },
      { value: 'duplicate', label: 'Duplicate' },
      { value: 'archive', label: 'Archive', disabled: true },
      { value: 'sep', divider: true, label: '' },
      { value: 'delete', label: 'Delete', description: 'Permanent' },
    ],
    onSelect: (v) => { /* the chosen value */ },
  };
  return { contextMenu, ctxOpts };
}
~~~
:::

## Anchored to the host — position

Set `position` and the panel anchors to the **host** at that spot instead of the pointer, so it always
appears in the same place regardless of where you clicked inside the box. Omit `position` for the native
pointer-anchored feel.

:::demo ex-context-menu-position

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click anywhere</div>
~~~
~~~ts title="app.ts"
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const ctxOpts = {
    items: [
      { value: 'open', label: 'Open' },
      { value: 'rename', label: 'Rename' },
      { value: 'remove', label: 'Remove' },
    ],
    position: 'bottom-start', // anchor to the host, not the pointer
    onSelect: (v) => { /* … */ },
  };
  return { contextMenu, ctxOpts };
}
~~~
:::

## Custom option objects — accessors + emit

Drive the menu from **arbitrary objects** via accessors: `optionValue`, `optionLabel`,
`optionDescription` and `optionDisabled` map each row to the menu fields. With `emit: 'object'`,
`onSelect` receives the whole selected object back.

:::demo ex-context-menu-custom

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const actions = [
    { id: 'share', title: 'Share', hint: 'Anyone with the link', blocked: false },
    { id: 'star', title: 'Star', hint: 'Add to favourites', blocked: false },
    { id: 'lock', title: 'Lock', hint: 'Requires admin', blocked: true },
  ];
  const ctxOpts = {
    items: actions,
    optionValue: (a) => a.id,
    optionLabel: (a) => a.title,
    optionDescription: (a) => a.hint,
    optionDisabled: (a) => a.blocked,
    emit: 'object',
    onSelect: (a) => { /* the whole selected object */ },
  };
  return { contextMenu, ctxOpts };
}
~~~
:::

## Plain-string items — isDivider

`items` can be plain strings — each is its own value and label. A string carries no `divider` flag, so
supply `isDivider` to mark separators yourself.

:::demo ex-context-menu-strings

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const ctxOpts = {
    items: ['Cut', 'Copy', 'Paste', '', 'Select all'],
    isDivider: (s) => s === '',
    onSelect: (v) => { /* the chosen string */ },
  };
  return { contextMenu, ctxOpts };
}
~~~
:::
