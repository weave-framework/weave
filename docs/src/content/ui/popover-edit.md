# Popover Edit

Edit a value in place — click a piece of text and a small editor pops over it, commit with Enter or by clicking
away, cancel with Esc. It's a Weave **`use:` action** you attach to the element that displays the value, so a table
cell or a label becomes editable with no layout change.

:::demo popover-edit-demo

## Import

```ts
import { popoverEdit } from '@weave-framework/ui/popover-edit';
```

```scss
@use '@weave-framework/ui/popover-edit';
```

## Basic usage

Attach `use:popoverEdit` to the display element, with a `value` getter (seeds the editor) and an `onCommit` handler
(receives the new value). Click / Enter / **F2** opens the editor:

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ editCfg }}>{{ name() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { popoverEdit } from '@weave-framework/ui/popover-edit';

export function setup() {
  const name = signal('Weave Project');
  const editCfg = {
    value: () => name(),
    onCommit: (next) => name.set(next),
    label: 'Project name',
  };
  return { popoverEdit, editCfg, name };
}
~~~
:::

The default editor is a text field (sharing [Input](/ui/input)'s underline). **Enter** and **click-away** commit
via `onCommit`; **Esc** cancels; focus returns to the host either way.

## A custom editor

For anything other than plain text — a Select, a date field, a number — pass an `editor` factory that returns
`{ element, value, focusTarget? }`. The action manages the overlay, commit, and focus; you supply the control:

```ts
const editCfg = {
  value: () => status(),
  onCommit: (next) => status.set(next),
  editor: (current) => {
    // build and return { element, value: () => theSelectValue }
  },
};
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `() => string` | — | Current value getter (seeds the editor). |
| `onCommit` | `(next: string) => void` | — | Called with the new value on commit. |
| `editor` | `(value: string) => PopoverEditor` | *(text field)* | Build a custom editor. |
| `placeholder` | `string` | — | Placeholder for the default text editor. |
| `label` | `string` | — | Accessible name for the default editor. |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the host. |
| `disabled` | `boolean \| () => boolean` | `false` | Disable editing (reactive). |

## Accessibility

The host is made interactive (click / Enter / F2 to open, so it's keyboard-reachable) and the editor opens in a
non-modal overlay with focus moved into it and restored to the host on commit or cancel. Esc always cancels.
