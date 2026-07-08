# Tabs

Split content into panels the user switches between — an active tab marked with an accent square, the rest quiet. A
proper WAI-ARIA `tablist`: real `role="tab"` buttons over a rule, roving keyboard, one panel shown at a time.

:::demo tabs-demo

## Import

```ts
import Tabs from '@weave-framework/ui/tabs';
```

```scss
@use '@weave-framework/ui/tabs';
```

## Basic usage

Describe the tabs as data — each `{ label, content }` — and bind the active **index** with `value` + `onChange`.
`content` is a string, DOM node, or factory, mounted into that tab's panel:

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} value={{ idx() }} onChange={{ setIdx }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Tabs from '@weave-framework/ui/tabs';

export function setup() {
  const idx = signal(0);
  const tabs = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
~~~
:::

Leave `value` off and pass `defaultIndex` for an uncontrolled strip. Disable a single tab with `disabled` on its
item (it's skipped in keyboard nav).

## Activation

By default activation is **manual** — Arrow keys move focus, and Enter / Space / click selects. Set
`activateOnFocus={{ true }}` to make selection follow focus (arrowing switches panels immediately).

## Accessibility

It's the APG tabs pattern: `role="tablist"` of `role="tab"` buttons, each linked to its `role="tabpanel"` via
`aria-controls` / `aria-labelledby`, with a single roving tab stop. **Left / Right** move between tabs (wrapping,
skipping disabled), **Home / End** jump to the ends, and the panel is focusable.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tabs` | `TabItem<T>[]` | — | The tabs, each `{ label, content, disabled?, data? }`. `data` is an arbitrary payload `tabTemplate` can read. |
| `value` | `number` | — | Controlled active index. Ignored when uncontrolled. |
| `onChange` | `(index: number) => void` | — | Called with the next index on selection. |
| `defaultIndex` | `number` | `0` | Uncontrolled initial index. |
| `activateOnFocus` | `boolean` | `false` | Selection follows focus as you arrow. |
| `disabled` | `boolean` | `false` | Disable the whole tab set. |
| `label` | `string` | — | Accessible name for the `role="tablist"`. |
| `tabTemplate` | `(row: TabRowContext<T>) => Node` | — | Renders the whole content of each tab button (replacing the default label span) from the tab's data + state. See below. |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### `tabTemplate` — custom tab-button content

Pass an authored `@snippet` as `tabTemplate` to render the whole content of each `role="tab"`
button — an icon before the label, a badge, two lines. The framework still owns the button, ARIA,
roving tabindex and the panels; the template only fills the button's inner content. `label` stays
the accessible name (`aria-label`), and the active tab is styled via the `[aria-selected='true']`
hook. It re-renders when a tab's `selected` state flips. Omit it for the default label span — fully
back-compatible. Parallels the menu's `itemTemplate`. See the
[Custom tab-button content example](/examples/components/tabs).

The snippet receives a `TabRowContext<T>`:

| Field | Type | Description |
| --- | --- | --- |
| `item` | `TabItem<T>` | The tab's data object (bind `row.item.label`, `row.item.data.*`). |
| `label` | `string` | The tab's label — also the accessible name + typeahead text. |
| `index` | `number` | Zero-based position in the tab strip. |
| `selected` | `boolean` | True when this is the active tab (re-renders when it flips). |
| `disabled` | `boolean` | True when this tab is disabled. |
