# Tabs — examples

Every feature of `<Tabs>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Tabs reference page](/ui/tabs); this page is just the examples,
covering the full component surface.

```ts
import Tabs from '@weave-framework/ui/tabs';
```
```scss
@use '@weave-framework/ui/tabs';
```

## Basic — value + onChange

Describe the tabs as data — each `{ label, content }` — and bind the active **index** two-way with
`value` + `onChange`.

:::demo ex-tabs-basic

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

## Uncontrolled — defaultIndex

Leave `value` off and Tabs owns its own selection; `defaultIndex` seeds the initial tab.

:::demo ex-tabs-uncontrolled

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} defaultIndex={{ 1 }} />
~~~
~~~ts title="app.ts"
import Tabs from '@weave-framework/ui/tabs';

export function setup() {
  const tabs = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Activity', content: 'Recent activity shows here.' },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
~~~
:::

## Panel content — string, node, factory

Each tab's `content` is arbitrary: a plain string, a live DOM `Node`, or a factory `() => Node` built
fresh when the panel mounts.

:::demo ex-tabs-content

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} />
~~~
~~~ts title="app.ts"
import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

export function setup() {
  const node = document.createElement('em');
  node.textContent = 'A pre-built DOM node.';

  const tabs: TabItem[] = [
    { label: 'String', content: 'Plain text content.' },
    { label: 'Node', content: node },
    {
      label: 'Factory',
      content: () => {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = 'Built by a factory';
        return el;
      },
    },
  ];
  return { tabs };
}
~~~
:::

## Disabled tab

`disabled` on a single item makes that tab unselectable and skips it in keyboard nav.

:::demo ex-tabs-disabled

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} />
~~~
~~~ts title="app.ts"
import Tabs, { type TabItem } from '@weave-framework/ui/tabs';

export function setup() {
  const tabs: TabItem[] = [
    { label: 'Overview', content: 'A summary of everything.' },
    { label: 'Billing', content: 'Not available on your plan.', disabled: true },
    { label: 'Settings', content: 'Tweak your preferences.' },
  ];
  return { tabs };
}
~~~
:::

## Disabled group

`disabled` on the group turns off every tab at once.

:::demo ex-tabs-disabled-all

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} disabled={{ true }} />
~~~
:::

## Activation follows focus

By default activation is **manual** — Arrow keys move focus, Enter / Space / click selects. Set
`activateOnFocus` to make selection follow focus, so arrowing switches panels immediately.

:::demo ex-tabs-activate-on-focus

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} activateOnFocus={{ true }} />
~~~
:::

## Accessible label

`label` gives the tablist an accessible name (`aria-label` on the `role="tablist"`).

:::demo ex-tabs-label

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} label={{ 'Account sections' }} />
~~~
:::

## Custom class

`class` forwards extra classes onto the container for scoped styling.

:::demo ex-tabs-class

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} class={{ 'dense' }} />
~~~
:::

## Sliding indicator — `slidingIndicator`

Opt into an animated marker that **slides and resizes** to the active tab. The framework renders one
`.weave-tabs__indicator` element inside the list and, on every selection (and on resize), sets its
`transform: translateX()` + `width` to the active tab's box — the CSS transition does the rest. The
default look is a bottom accent underline; app CSS re-skins `.weave-tabs__indicator` to a pill (fill,
radius, full height). Off by default — Weave has no sliding marker unless asked.

:::demo ex-tabs-sliding-indicator

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} value={{ idx() }} onChange={{ setIdx }} slidingIndicator={{ true }} />
~~~
~~~scss title="app.scss"
// Re-skin the default underline into a sliding pill:
.weave-tabs__indicator {
  height: 100%;
  border-radius: 999px;
  background: var(--surface-active);
}
~~~
:::

## Custom tab-button content — `tabTemplate`

`tabTemplate` hands `<Tabs>` an authored `@snippet` that renders the **whole** content of each
`role="tab"` button — an icon before the label, a badge, two lines — from the tab's
[`TabRowContext`](/ui/tabs): `row.item` (with your `data` payload) plus `row.label`, `row.index`,
`row.selected` and `row.disabled`. The framework still owns the button, ARIA, roving tabindex and
the panels; `row.label` stays the accessible name (`aria-label`), and the active tab is styled via
the `[aria-selected='true']` hook. It re-renders when a tab's `selected` flips. Omit it for the
default label span — fully back-compatible. Mirrors the menu's
[`itemTemplate`](/examples/components/menu).

:::demo ex-tabs-template

:::tabs
~~~html title="app.html"
<Tabs tabs={{ tabs }} value={{ idx() }} onChange={{ setIdx }} tabTemplate={{ tabButton }} />

@snippet tabButton(row) {
  <Icon name={{ row.item.data.icon }} />
  <span>{{ row.label }}</span>
}
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Tabs, { type TabItem } from '@weave-framework/ui/tabs';
import Icon from '@weave-framework/ui/icon';

export function setup() {
  const idx = signal(0);
  const tabs: TabItem<{ icon: string }>[] = [
    { label: 'Profile',     content: 'Your public profile.',      data: { icon: 'user' } },
    { label: 'Password',    content: 'Change your password.',     data: { icon: 'lock' } },
    { label: 'Preferences', content: 'Theme, language and more.', data: { icon: 'settings' } },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
~~~
:::
