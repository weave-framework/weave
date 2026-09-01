# Context Menu

A right-click menu on any surface — the same list as [Menu](/ui/menu), but opened at the pointer on `contextmenu`
(right-click, or the context-menu key). It's a Weave **`use:` action** you attach to the element it should apply to.

:::demo context-menu-demo

## Import

```ts
import { contextMenu } from '@weave-framework/ui/context-menu';
```

```scss
@use 'pkg:@weave-framework/ui/menu';
```

Context Menu has no stylesheet of its own — it renders the `.weave-menu` visual, so pull in the Menu styles (or the
umbrella `pkg:@weave-framework/ui`).

## Basic usage

Attach `use:contextMenu` to the host, with the items and an `onSelect`. The browser's default menu is suppressed and
yours opens at the click point:

:::tabs
~~~html title="app.html"
<div use:contextMenu={{ ctxOpts }}>Right-click me</div>
~~~
~~~ts title="app.ts"
import { contextMenu } from '@weave-framework/ui/context-menu';

export function setup() {
  const ctxOpts = {
    items: [
      { value: 'copy', label: 'Copy' },
      { value: 'paste', label: 'Paste' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v) => { /* the chosen value */ },
  };
  return { contextMenu, ctxOpts };
}
~~~
:::

Items use the same shape as [Menu](/ui/menu) — default `{ value, label, description?, divider?, disabled? }`,
plain strings, or arbitrary objects via the `option*` accessors. The menu positions itself at the pointer and flips
to stay on-screen.

## Anchoring

Leave `position` off and the panel opens **at the pointer** — the native right-click feel. Set it (`'bottom-start'`,
`'top-end'`, `'bottom'`, … or an explicit anchor pair) and the panel anchors to the **host element** at that
position instead, so it always appears in the same spot no matter where inside the host you clicked. Keyboard opens
are always host-anchored.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `T[]` | — | **Required.** The rows — default shape, plain strings, or objects via the accessors. |
| `onSelect` | `(selected: string \| T) => void` | — | **Required.** The chosen row (a value string, or the whole object when `emit` is `'object'`). |
| `position` | `MenuPosition` | — | Omitted: open at the pointer. Set: anchor to the host at this position. |
| `selected` | `string \| (() => string \| undefined)` | — | Mark a value with a check (`role="menuitemradio"`), turning it into a value picker. Pass a getter to keep it live. |
| `isDivider` | `(item: T) => boolean` | `item.divider` | Is this row a hairline separator? |
| `optionValue` | `(item: T) => string` | the string, or `item.value` | Which field is the value. |
| `optionLabel` | `(item: T) => string` | the string, or `item.label` | Which field to display (also the typeahead text). |
| `optionDescription` | `(item: T) => string \| undefined` | `item.description` | Optional subtext under the label. |
| `optionDisabled` | `(item: T) => boolean` | `item.disabled` | Is this row disabled? |
| `emit` | `'value' \| 'object'` | `'value'` | What `onSelect` receives. |
| `optionContent` | `(item: T) => Node` | — | Custom row **body** in place of the default label span (`optionLabel` still names it). |
| `itemTemplate` | `(row: MenuRowContext<T>) => Node` | — | Per-row template owning the **entire** row — layout, marker and selected/active styling. |

## Accessibility

It opens on the native `contextmenu` event (right-click **and** the keyboard context-menu key / Shift+F10), so it's
reachable without a mouse. The panel is a `role="menu"` with full arrow-key navigation, typeahead, Enter to select,
and Esc to close — the same as [Menu](/ui/menu). Focus returns to the host on close.

:::callout tip "Keep a visible alternative"
A right-click menu is a shortcut, not the only way to reach an action — make sure the same actions are available
through a visible control (a Menu button, a toolbar) for discoverability and touch.
:::

<!-- gen-ui-types:begin -->
### Types

~~~ts
import type { ContextMenuOptions, MenuItem, MenuPosition, MenuRowContext, OptionAccessors } from '@weave-framework/ui/context-menu';
~~~
<!-- gen-ui-types:end -->

## When it goes wrong

:::callout trap "There is no `<ContextMenu>` tag — it is a `use:` action"
This one attaches to an element you already have, rather than being placed as a component:

~~~ts title="in your .ts"
import { contextMenu } from '@weave-framework/ui/context-menu';
~~~
~~~html title="in your template"
<button use:contextMenu={{ { items: items() } }}>Right-click me</button>
~~~

`use:` is what gives it the element to own. Writing `<ContextMenu>` is a build error naming a component that
was never meant to exist.
:::

**It attaches to nothing.** A `use:` action needs **one** element. Put it on a component that renders
several top-level nodes and you get: `use: on <X>: actions attach to a single root element, but <X>
renders N nodes.` Move it onto a real element inside.

**It never appears.** Two usual causes: the stylesheet is a separate import
(`@use 'pkg:@weave-framework/ui/context-menu';`), and the action returns a cleanup that Weave calls on unmount —
so an element removed and re-added gets a fresh one, which is correct and occasionally surprising.
