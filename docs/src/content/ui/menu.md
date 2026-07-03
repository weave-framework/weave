# Menu

A dropdown of actions that opens from a trigger — the "⋯" overflow, an "Actions ▾" button. Menu is a Weave
**`use:` action**: attach it to any trigger element with a list of items, and it handles opening, keyboard, and
positioning.

:::demo menu-demo

## Import

```ts
import { menu } from '@weave-framework/ui/menu';
```

```scss
@use '@weave-framework/ui/menu';
```

## Basic usage

Return the action and its options from `setup`, then attach it with `use:menu` on the trigger. `items` are the menu
entries; `onSelect` fires with the chosen one:

:::tabs
~~~html title="app.html"
<button use:menu={{ menuOpts }}>Actions ▾</button>
~~~
~~~ts title="app.ts"
import { menu } from '@weave-framework/ui/menu';

export function setup() {
  const menuOpts = {
    items: [
      { value: 'edit', label: 'Edit' },
      { value: 'duplicate', label: 'Duplicate' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v) => { /* v is the chosen value */ },
  };
  return { menu, menuOpts };
}
~~~
:::

## Item shape

Items are the default `{ value, label, description?, disabled?, divider? }`, plain strings, or arbitrary objects via
the `optionValue` / `optionLabel` accessors (same as [Select](/ui/select)). Mark an item `divider: true` for a
hairline separator; `disabled: true` to skip it. Pass `emit: 'object'` to get the whole item in `onSelect`.

## Accessibility

The trigger gets `aria-haspopup="menu"` / `aria-expanded`; the panel is a `role="menu"` of `role="menuitem"` rows.
Open with click or ↓ / Enter; **Up / Down** move (wrapping, skipping dividers/disabled), Enter selects, Esc closes
and returns focus to the trigger. Typeahead jumps to a matching item.

## Related

- **[Menubar](/ui/menubar)** — a row of always-visible top-level menus (File / Edit / View).
- **[Context Menu](/ui/context-menu)** — the same list, opened on right-click.
