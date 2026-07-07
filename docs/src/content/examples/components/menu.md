# Menu — examples

Every feature of the `menu` action, each as a live, self-contained example you can read and lift
straight into your project. The prose lives on the [Menu reference page](/ui/menu); this page is just
the examples, covering the full option surface.

Menu is a Weave **`use:` action**, not a `<Tag>` — attach it to a trigger with `use:menu={{ opts }}`,
where `opts` is returned from `setup`. Never inline the options object: `use:menu={{ { items: … } }}`
compiles to `() => { … }`, which JS reads as a block, so the options are silently lost.

```ts
import { menu } from '@weave-framework/ui/menu';
```
```scss
@use '@weave-framework/ui/menu';
```

## Basic — items + onSelect

The minimal menu: an `items` array of `{ value, label }` and an `onSelect` callback that fires with the
chosen value. Compose it onto a `<Button>` — `use:` forwards to the button's root.

:::demo ex-menu-basic

:::tabs
~~~html title="app.html"
<Button use:menu={{ actions }}>Actions ▾</Button>
~~~
~~~ts title="app.ts"
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

export function setup() {
  const picked = signal('—');
  const actions: MenuOptions = {
    items: [
      { value: 'edit', label: 'Edit' },
      { value: 'duplicate', label: 'Duplicate' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v) => picked.set(String(v)),
  };
  return { menu, actions, picked };
}
~~~
:::

## Item descriptions

`description` adds a smaller, lighter subtext line under an item's label — a one-line hint about what
each choice does.

:::demo ex-menu-descriptions

:::tabs
~~~html title="app.html"
<Button variant={{ 'ghost' }} use:menu={{ visibility }}>Visibility ▾</Button>
~~~
~~~ts title="app.ts"
const visibility: MenuOptions = {
  items: [
    { value: 'public', label: 'Public', description: 'Anyone with the link can view' },
    { value: 'team', label: 'Team', description: 'Only people in your workspace' },
    { value: 'private', label: 'Private', description: 'Just you' },
  ],
  onSelect: (v) => chosen.set(String(v)),
};
~~~
:::

## Dividers & disabled items

`divider: true` renders a hairline separator between groups; `disabled: true` greys an item and skips it
in keyboard navigation. Neither is selectable.

:::demo ex-menu-dividers-disabled

:::tabs
~~~html title="app.html"
<Button use:menu={{ fileMenu }}>File ▾</Button>
~~~
~~~ts title="app.ts"
const fileMenu: MenuOptions = {
  items: [
    { value: 'new', label: 'New file' },
    { value: 'open', label: 'Open…' },
    { value: 'sep1', label: '', divider: true },
    { value: 'save', label: 'Save' },
    { value: 'save-as', label: 'Save as…', disabled: true },
    { value: 'sep2', label: '', divider: true },
    { value: 'close', label: 'Close' },
  ],
  onSelect: (v) => ran.set(String(v)),
};
~~~
:::

## Position

`position` chooses where the panel sits relative to the trigger — a preset (`'bottom-start'`,
`'top-start'`, `'right-start'`, …) or an explicit anchor pair. It flips to the opposite side on overflow.
Default is `'bottom-start'` (below, left-aligned).

:::demo ex-menu-position

:::tabs
~~~html title="app.html"
<Button use:menu={{ below }}>Bottom-end ▾</Button>
<Button use:menu={{ above }}>Top-start ▴</Button>
<Button use:menu={{ right }}>Right-start ▸</Button>
~~~
~~~ts title="app.ts"
const items = [
  { value: 'cut', label: 'Cut' },
  { value: 'copy', label: 'Copy' },
  { value: 'paste', label: 'Paste' },
];
const onSelect = (v) => picked.set(String(v));

const below: MenuOptions = { items, onSelect, position: 'bottom-end' };
const above: MenuOptions = { items, onSelect, position: 'top-start' };
const right: MenuOptions = { items, onSelect, position: 'right-start' };
~~~
:::

## Plain string items

Items can be bare strings — each string is both the value and the label, no accessors needed. `onSelect`
receives that string.

:::demo ex-menu-strings

:::tabs
~~~html title="app.html"
<Button variant={{ 'ghost' }} use:menu={{ sortMenu }}>Sort by ▾</Button>
~~~
~~~ts title="app.ts"
const sortMenu: MenuOptions<string> = {
  items: ['Name', 'Date modified', 'Size', 'Kind'],
  onSelect: (v) => by.set(String(v)),
};
~~~
:::

## Arbitrary objects — accessors + emit

Drive the menu from any object shape via the `option*` accessors (`optionValue` / `optionLabel` /
`optionDescription` / `optionDisabled`), mark separators with `isDivider`, and pass `emit: 'object'` to
receive the whole item — not just a value string — in `onSelect`.

:::demo ex-menu-accessors

:::tabs
~~~html title="app.html"
<Button use:menu={{ assignMenu }}>Assign to ▾</Button>
~~~
~~~ts title="app.ts"
interface User { id: string; name: string; role: string; suspended: boolean; sep?: boolean; }

const assignMenu: MenuOptions<User> = {
  items: users,
  optionValue: (u) => u.id,
  optionLabel: (u) => u.name,
  optionDescription: (u) => u.role,
  optionDisabled: (u) => u.suspended,
  isDivider: (u) => Boolean(u.sep),
  emit: 'object',
  onSelect: (u) => assignee.set(typeof u === 'string' ? u : u.name),
};
~~~
:::

## Value picker — `selected`

`selected` turns the menu into a **value picker**: the row whose value equals it is marked with a
check (`role=menuitemradio` + `aria-checked`) — the current density, view, language, sort order, and
the like. Pass a **getter** (`selected: () => density()`) so the mark tracks the value; it's re-read on
every open, so re-opening always shows the current choice ticked.

:::demo ex-menu-selected

:::tabs
~~~html title="app.html"
<Button variant={{ 'ghost' }} use:menu={{ viewMenu }}>Density: {{ density() }} ▾</Button>
~~~
~~~ts title="app.ts"
const density = signal('comfortable');
const viewMenu: MenuOptions = {
  items: [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'cozy', label: 'Cozy' },
    { value: 'compact', label: 'Compact' },
  ],
  selected: () => density(),           // ✓ marks the active row; re-read on every open
  onSelect: (v) => density.set(String(v)),
};
~~~
:::

## Custom row content — `optionContent`

`optionContent` returns a DOM node used as the row body in place of the default label span — a flag,
an icon, a colour swatch, an avatar. `optionLabel` still drives the accessible name **and** typeahead,
so typing "ne" still jumps to Nederlands even though the row shows a flag. Reach for this for a simple
content swap; when the row's design depends on its state (checked / active), use `itemTemplate` below.

:::demo ex-menu-custom

:::tabs
~~~html title="app.html"
<Button use:menu={{ langMenu }}>Language ▾</Button>
~~~
~~~ts title="app.ts"
interface Lang { value: string; label: string; flag: string; }

// optionContent builds the row body — a flag + the native name.
const flagRow = (l: Lang): Node => {
  const row = document.createElement('span');
  row.style.cssText = 'display:inline-flex; gap:8px; align-items:center;';
  const flag = document.createElement('span'); flag.textContent = l.flag;
  const name = document.createElement('span'); name.textContent = l.label;
  row.append(flag, name);
  return row;
};

const langMenu: MenuOptions<Lang> = {
  items: langs,
  optionValue: (l) => l.value,
  optionLabel: (l) => l.label,      // still the accessible name + typeahead text
  optionContent: flagRow,
  onSelect: (v) => locale.set(String(v)),
};
~~~
:::

## Authored row template — `itemTemplate`

For a row whose **design depends on its state**, hand the menu an authored `@snippet` via
`itemTemplate`. It renders the **whole** row (weave stamps no default label/check) and receives the full
row context: `row.item` (the JSON), plus `row.checked` (matches `selected`), `row.active()` (a reactive
keyboard-highlight getter), `row.index` and `row.disabled`. The template owns the layout, the marker
(here a **trailing** `<Icon>` shown only on the checked row) and the selected background. `optionLabel`
still drives the accessible name + typeahead; `selected` still sets the ARIA. Because a `@snippet` is a
template-local value, add it inline — `{ ...langMenu, itemTemplate: langRow }`.

:::demo ex-menu-template

:::tabs
~~~html title="app.html"
<Button use:menu={{ { ...langMenu, itemTemplate: langRow } }}>Language ▾</Button>

@snippet langRow(row) {
  <span
    style="display:flex; align-items:center; gap:10px; padding:8px 12px; width:100%;"
    style:background={{ row.checked ? 'var(--surface-active)' : 'transparent' }}
    style:font-weight={{ row.checked ? '600' : '400' }}
  >
    <span>{{ row.item.flag }}</span>
    <span style="flex:1;">{{ row.item.label }}</span>
    @if (row.checked) { <Icon name={{ 'check' }} /> }
  </span>
}
~~~
~~~ts title="app.ts"
const locale = signal('nl');
const langMenu: MenuOptions<Lang> = {
  items: langs,                        // { value, label, flag }
  optionValue: (l) => l.value,
  optionLabel: (l) => l.label,         // accessible name + typeahead
  selected: () => locale(),            // drives row.checked + the ARIA
  onSelect: (v) => locale.set(String(v)),
};
~~~
:::
