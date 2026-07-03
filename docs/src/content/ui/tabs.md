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
| `tabs` | `TabItem[]` | — | The tabs, each `{ label, content, disabled? }`. |
| `value` | `number` | — | Controlled active index. Ignored when uncontrolled. |
| `onChange` | `(index: number) => void` | — | Called with the next index on selection. |
| `defaultIndex` | `number` | `0` | Uncontrolled initial index. |
| `activateOnFocus` | `boolean` | `false` | Selection follows focus as you arrow. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
