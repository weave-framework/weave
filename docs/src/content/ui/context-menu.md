# Context Menu

A right-click menu on any surface — the same list as [Menu](/ui/menu), but opened at the pointer on `contextmenu`
(right-click, or the context-menu key). It's a Weave **`use:` action** you attach to the element it should apply to.

:::demo context-menu-demo

## Import

```ts
import { contextMenu } from '@weave-framework/ui/context-menu';
```

```scss
@use '@weave-framework/ui/context-menu';
```

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

Items use the same shape as [Menu](/ui/menu) — default `{ value, label, divider?, disabled? }`, strings, or objects
via accessors. The menu positions itself at the pointer and flips to stay on-screen.

## Accessibility

It opens on the native `contextmenu` event (right-click **and** the keyboard context-menu key / Shift+F10), so it's
reachable without a mouse. The panel is a `role="menu"` with full arrow-key navigation, typeahead, Enter to select,
and Esc to close — the same as [Menu](/ui/menu). Focus returns to the host on close.

:::callout tip "Keep a visible alternative"
A right-click menu is a shortcut, not the only way to reach an action — make sure the same actions are available
through a visible control (a Menu button, a toolbar) for discoverability and touch.
:::
