# Tabs

Split content into panels the user switches between — an active tab marked with an accent square, the rest quiet. A
proper WAI-ARIA `tablist`: real `role="tab"` buttons over a rule, roving keyboard, one panel shown at a time.

:::demo tabs-demo

## Import

```ts
import Tabs from '@weave-framework/ui/tabs';
```

```scss
@use 'pkg:@weave-framework/ui/tabs';
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
item (it's skipped in keyboard nav), or the whole strip with `disabled` on `<Tabs>`.

Panel content is appended into its panel once, on mount — all panels stay in the DOM and the inactive ones are
`hidden`, so panel state survives switching tabs.

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
| `slidingIndicator` | `boolean` | `false` | Render an animated `.weave-tabs__indicator` that slides + resizes to the active tab. App CSS owns its look. |
| `disabled` | `boolean` | `false` | Disable the whole tab set. |
| `label` | `string` | — | Accessible name for the `role="tablist"`. |
| `tabTemplate` | `(row: TabRowContext<T>) => Node` | — | Renders the whole content of each tab button (replacing the default label span *and* the accent marker) from the tab's data + state. See below. |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### `tabTemplate` — custom tab-button content

Pass an authored `@snippet` as `tabTemplate` to render the whole content of each `role="tab"`
button — an icon before the label, a badge, two lines. The framework still owns the button, ARIA,
roving tabindex and the panels; the template only fills the button's inner content. `label` stays
the accessible name (`aria-label`), and the active tab is styled via the `[aria-selected='true']`
hook. It re-renders when a tab's `selected` state flips, or when that tab's data object changes.
Omit it for the default label span. Parallels the menu's `itemTemplate`. See the
[Custom tab-button content example](/examples/components/tabs).

The snippet receives a `TabRowContext<T>`:

| Field | Type | Description |
| --- | --- | --- |
| `item` | `TabItem<T>` | The tab's data object (bind `row.item.label`, `row.item.data.*`). |
| `label` | `string` | The tab's label — also the accessible name + typeahead text. |
| `index` | `number` | Zero-based position in the tab strip. |
| `selected` | `boolean` | True when this is the active tab (re-renders when it flips). |
| `disabled` | `boolean` | True when this tab is disabled. |

<!-- gen-ui-types:begin -->
### Types

~~~ts
import type { TabContent, TabItem, TabRowContext, TabsProps, TabsContext } from '@weave-framework/ui/tabs';
~~~
<!-- gen-ui-types:end -->

## When it goes wrong

:::callout trap "It renders, but nothing is inside it"
This component **projects** what you put in it. If the slot is empty — or the data it iterates is still
loading — you get the frame with nothing in it, which looks like a broken component and is an empty one.

Check the data first: an `@for` over an array that is `[]` until a fetch resolves renders exactly
nothing, correctly.
:::

**It renders unstyled.** `@use 'pkg:@weave-framework/ui/tabs';` is a separate import from the component.

**State that resets when the list changes.** Give any `@for` a stable `track`. Keyed by index, a row is a
different row the moment the list is filtered or sorted, and anything it held goes with it.

**A style of yours that will not reach inside.** Its root carries its own scope attribute, so use
`:global()` from a container you own — see [Styling](/learn/styling#the-one-gotcha-worth-knowing).
