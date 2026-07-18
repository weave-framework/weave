# Menu

A dropdown of actions that opens from a trigger — an overflow button, an "Actions" button with a chevron. Menu is a Weave
**`use:` action**: attach it to any trigger element with a list of items, and it handles opening, keyboard, and
positioning.

:::demo menu-demo

## Import

```ts
import { menu } from '@weave-framework/ui/menu';
```

```scss
@use 'pkg:@weave-framework/ui/menu';
```

## Basic usage

Return the action and its options from `setup`, then attach it with `use:menu` on the trigger. `items` are the menu
entries; `onSelect` fires with the chosen one:

:::tabs
~~~html title="app.html"
<button use:menu={{ menuOpts }}>Actions <Icon name={{ 'chevron-down' }} /></button>
~~~
~~~ts title="app.ts"
import { menu } from '@weave-framework/ui/menu';
import Icon from '@weave-framework/ui/icon';

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

## Where the panel sits

`position` places the panel relative to the trigger — a preset (`'bottom-start'`, `'bottom-end'`, `'top'`, …) or an
explicit anchor pair — and it flips to the opposite side when it would overflow. Default `'bottom-start'` (below,
left-aligned).

## A value picker

Pass `selected` (a value, or better a getter such as `() => lang()`) to turn the menu into a picker: the matching
item becomes a `role="menuitemradio"` with `aria-checked` and shows a check. It's read on every open, so the mark
tracks the current value. Omit it for a plain action menu.

## Custom rows

`optionContent` returns a DOM node used as the row body in place of the default label span. `itemTemplate` goes
further — an authored `@snippet` that renders the **entire** row (no default label or check markup), so the
template owns the layout, the marker and the selected/active styling; it takes precedence over `optionContent`. In
both cases `optionLabel` still drives the accessible name and typeahead.

## Accessibility

The trigger gets `aria-haspopup="menu"` / `aria-expanded`; the panel is a `role="menu"` of `role="menuitem"` rows.
Open with click or ↓ / Enter / Space; **Up / Down** move (wrapping, skipping dividers/disabled), Enter selects, Esc
closes and returns focus to the trigger. Typeahead jumps to a matching item. Opening by keyboard highlights the
first item; opening by click highlights none.

## API reference

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `T[]` | — | The options — the default `{ value, label, description?, disabled?, divider? }`, plain strings, or arbitrary objects read through the accessors. |
| `onSelect` | `(selected: string \| T) => void` | — | Called with the chosen option — its value, or the whole object when `emit: 'object'`. |
| `selected` | `string \| (() => string \| undefined)` | — | Make it a value picker: the matching item is checked. |
| `optionContent` | `(item: T) => Node` | — | Custom row body in place of the default label span. |
| `itemTemplate` | `(row: MenuRowContext<T>) => Node` | — | Authored `@snippet` rendering the entire row. Wins over `optionContent`. |
| `isDivider` | `(item: T) => boolean` | `item.divider` | Is this option a hairline separator? |
| `position` | `MenuPosition` | `'bottom-start'` | Panel placement relative to the trigger; flips on overflow. |
| `optionValue` | `(item: T) => string` | `item.value` | Read an arbitrary object's value. |
| `optionLabel` | `(item: T) => string` | `item.label` | Read its label — the visible text, accessible name and typeahead target. |
| `optionDescription` | `(item: T) => string \| undefined` | `item.description` | Read its subtext. |
| `optionDisabled` | `(item: T) => boolean` | `item.disabled` | Is the option disabled? |
| `emit` | `'value' \| 'object'` | `'value'` | What a selection carries. |

## Related

- **[Menubar](/ui/menubar)** — a row of always-visible top-level menus (File / Edit / View).
- **[Context Menu](/ui/context-menu)** — the same list, opened on right-click.
