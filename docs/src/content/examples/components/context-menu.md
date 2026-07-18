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
// The action has no stylesheet of its own — its panel *is* the `.weave-menu` visual,
// so pull in the menu styles.
@use 'pkg:@weave-framework/ui/menu';
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

## Value picker — `selected`

`selected` turns it into a **value picker**: the row whose value equals it is marked with a check
(`role=menuitemradio` + `aria-checked`). Pass a getter so the mark tracks the value — it's re-read on
every right-click.

:::demo ex-context-menu-selected

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
export function setup() {
  const sort = signal('name');
  const ctxOpts = {
    items: [
      { value: 'name', label: 'Sort by name' },
      { value: 'date', label: 'Sort by date' },
      { value: 'size', label: 'Sort by size' },
    ],
    selected: () => sort(),            // ✓ marks the active row; re-read on every open
    onSelect: (v) => sort.set(v),
  };
  return { contextMenu, ctxOpts, sort };
}
~~~
:::

## Custom row content — `optionContent`

`optionContent` returns a DOM node used as the row body in place of the default label — a flag, an
icon, a swatch. `optionLabel` still drives the accessible name and typeahead. For a row whose design
depends on its state (checked / active), use `itemTemplate` below.

:::demo ex-context-menu-content

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click here</div>
~~~
~~~ts title="app.ts"
export function setup() {
  const flagRow = (l) => {
    const row = document.createElement('span');
    row.style.cssText = 'display:inline-flex; gap:8px; align-items:center;';
    const flag = document.createElement('span'); flag.textContent = l.flag;
    const name = document.createElement('span'); name.textContent = l.label;
    row.append(flag, name);
    return row;
  };
  const ctxOpts = {
    items: langs,                      // { value, label, flag }
    optionValue: (l) => l.value,
    optionLabel: (l) => l.label,       // still the accessible name + typeahead
    optionContent: flagRow,
    onSelect: (v) => locale.set(v),
  };
  return { contextMenu, ctxOpts, locale };
}
~~~
:::

## Authored row template — `itemTemplate`

For a row whose design depends on its state, hand the menu an authored `@snippet` via `itemTemplate`.
It renders the **whole** row from the full row context — `row.item` plus `row.checked`, reactive
`row.active()`, `row.index`, `row.disabled` — owning the layout, the marker (here a **trailing** `<Icon>`
on the checked row) and the selected styling. `optionLabel` still drives the accessible name + typeahead;
`selected` still sets the ARIA. Add the snippet inline (`{ ...ctxOpts, itemTemplate: langRow }`) because a
`@snippet` is a template-local value.

:::demo ex-context-menu-template

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ { ...ctxOpts, itemTemplate: langRow } }}>Right-click here</div>

@snippet langRow(row) {
  <span
    style="display:flex; align-items:center; gap:10px; padding:8px 12px; width:100%;"
    style:background={{ row.checked ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent' }}
    style:font-weight={{ row.checked ? '600' : '400' }}
  >
    <span>{{ row.item.flag }}</span>
    <span style="flex:1;">{{ row.item.label }}</span>
    @if (row.checked) { <Icon name={{ 'check' }} /> }
  </span>
}
~~~
~~~ts title="app.ts"
export function setup() {
  const locale = signal('nl');
  const ctxOpts = {
    items: langs,                      // { value, label, flag }
    optionValue: (l) => l.value,
    optionLabel: (l) => l.label,
    selected: () => locale(),          // drives row.checked + the ARIA
    onSelect: (v) => locale.set(v),
  };
  return { contextMenu, ctxOpts, locale };
}
~~~
:::
