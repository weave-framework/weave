# Popover Edit — examples

Every feature of `use:popoverEdit`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Popover Edit reference page](/ui/popover-edit); this page is just
the examples, covering the full action surface.

```ts
import { popoverEdit } from '@weave-framework/ui/popover-edit';
```
```scss
@use '@weave-framework/ui/popover-edit';
```

Every options object lives in `setup()` and is referenced by name — an inline object literal passed to a
`use:` action compiles to a JS block and is lost.

## Basic — value + onCommit

The minimal contract: a `value` getter seeds the editor, `onCommit` receives the new value on Enter or
click-away. Click / Enter / **F2** opens it.

:::demo ex-popover-edit-basic

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ cfg }} tabindex="0">{{ name() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { popoverEdit } from '@weave-framework/ui/popover-edit';

export function setup() {
  const name = signal('Weave Project');
  const cfg = {
    value: () => name(),
    onCommit: (next) => name.set(next),
    label: 'Project name',
  };
  return { popoverEdit, cfg, name };
}
~~~
:::

## Placeholder & label

`placeholder` fills the empty default editor with a hint; `label` is its accessible name (and the overlay's
`aria-label`). Start empty to see the placeholder.

:::demo ex-popover-edit-placeholder

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ cfg }} tabindex="0">{{ nickname() || '—' }}</span>
~~~
~~~ts title="app.ts"
const nickname = signal('');
const cfg = {
  value: () => nickname(),
  onCommit: (next) => nickname.set(next),
  placeholder: 'e.g. Ada',
  label: 'Nickname',
};
~~~
:::

## Position

`position` places the popover relative to the host (default `'bottom-start'`). Named presets flip to their
opposite on overflow; an explicit anchor pair gives full 3×3 control. Here `'top-start'` opens above.

:::demo ex-popover-edit-position

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ cfg }} tabindex="0">{{ title() }}</span>
~~~
~~~ts title="app.ts"
const title = signal('Q3 Report');
const cfg = {
  value: () => title(),
  onCommit: (next) => title.set(next),
  label: 'Report title',
  position: 'top-start',
};
~~~
:::

## Disabled — reactive

`disabled` takes a boolean or a reactive getter. Pass `() => locked()` and editing follows a signal — flip
the lock and the same host stops opening the editor.

:::demo ex-popover-edit-disabled

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ cfg }} tabindex="0">{{ amount() }}</span>
<button type="button" on:click={{ toggle }}>{{ locked() ? 'Unlock editing' : 'Lock editing' }}</button>
~~~
~~~ts title="app.ts"
const amount = signal('$42.00');
const locked = signal(true);
const cfg = {
  value: () => amount(),
  onCommit: (next) => amount.set(next),
  label: 'Amount',
  disabled: () => locked(),
};
return { popoverEdit, cfg, locked, toggle: () => locked.set(!locked()), amount };
~~~
:::

## Custom editor

`editor` is a factory: given the current value it returns `{ element, read, focusTarget? }`. The action owns
the overlay, commit and focus; you own the control. Here a native `<select>` replaces the default text field —
`read` reports its value, `focusTarget` gets initial focus.

:::demo ex-popover-edit-custom-editor

:::tabs
~~~html title="app.html"
<span use:popoverEdit={{ cfg }} tabindex="0">{{ status() }}</span>
~~~
~~~ts title="app.ts"
const status = signal('In progress');

const selectEditor = (current) => {
  const select = document.createElement('select');
  for (const label of ['Todo', 'In progress', 'Done']) {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    if (label === current) opt.selected = true;
    select.appendChild(opt);
  }
  return { element: select, read: () => select.value, focusTarget: select };
};

const cfg = {
  value: () => status(),
  onCommit: (next) => status.set(next),
  label: 'Status',
  editor: selectEditor,
};
~~~
:::

## Editable table cells

The spreadsheet gesture end to end: each cell gets its own config, click a cell to edit in place, Enter or
click-away commits, Esc restores.

:::demo ex-popover-edit-table

:::tabs
~~~html title="app.html"
<td use:popoverEdit={{ nameCfg }} tabindex="0">{{ name() }}</td>
<td use:popoverEdit={{ roleCfg }} tabindex="0">{{ role() }}</td>
~~~
~~~ts title="app.ts"
const name = signal('Ada Lovelace');
const role = signal('Engineer');

const nameCfg = {
  value: () => name(),
  onCommit: (next) => name.set(next),
  label: 'Name',
  placeholder: 'Full name',
};
const roleCfg = {
  value: () => role(),
  onCommit: (next) => role.set(next),
  label: 'Role',
  placeholder: 'Job title',
};
~~~
:::
