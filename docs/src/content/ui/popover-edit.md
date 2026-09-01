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
@use 'pkg:@weave-framework/ui/popover-edit';
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

For anything other than plain text — a Select, a date field, a number — pass an `editor` factory that receives the
current value and returns a `PopoverEditor`: `{ element, read, focusTarget? }`. `element` is the DOM to put in the
popover, `read()` is called on commit to get the new value, and `focusTarget` is what gets focus on open (defaults
to `element`). The action manages the overlay, commit, and focus; you supply the control:

```ts
const editCfg = {
  value: () => status(),
  onCommit: (next) => status.set(next),
  editor: (current) => {
    // build the control, then:
    return { element: el, read: () => el.value };
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
| `label` | `string` | `'Edit'` (panel) | Accessible name for the popover dialog, and for the default text editor. |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the host. |
| `disabled` | `boolean \| () => boolean` | `false` | Disable editing (reactive). |

## Accessibility

The host gets `aria-haspopup="dialog"` and `aria-expanded`, and opens on click / Enter / F2. The editor opens in a
non-modal `role="dialog"` overlay with focus moved into it (the default text editor's contents are selected) and
restored to the host on commit or cancel. Esc always cancels.

Give the host its own keyboard reachability — `use:popoverEdit` wires the key handler, but a non-interactive
element such as a `<span>` or `<td>` still needs a `tabindex` of your own to receive focus.

## When it goes wrong

:::callout trap "There is no `<PopoverEdit>` tag — it is a `use:` action"
This one attaches to an element you already have, rather than being placed as a component:

~~~ts title="in your .ts"
import { popoverEdit } from '@weave-framework/ui/popover-edit';
~~~
~~~html title="in your template"
<button use:popoverEdit={{ editCfg }}>Edit</button>
~~~

`use:` is what gives it the element to own. Writing `<PopoverEdit>` is a build error naming a component that
was never meant to exist.
:::

**It attaches to nothing.** A `use:` action needs **one** element. Put it on a component that renders
several top-level nodes and you get: `use: on <X>: actions attach to a single root element, but <X>
renders N nodes.` Move it onto a real element inside.

**It never appears.** Two usual causes: the stylesheet is a separate import
(`@use 'pkg:@weave-framework/ui/popover-edit';`), and the action returns a cleanup that Weave calls on unmount —
so an element removed and re-added gets a fresh one, which is correct and occasionally surprising.
