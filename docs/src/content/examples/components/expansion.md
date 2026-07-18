# Expansion Panel — examples

Every feature of `<Expansion>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Expansion reference page](/ui/expansion); this page is just the examples,
covering the full component surface.

```ts
import Expansion from '@weave-framework/ui/expansion';
```
```scss
@use 'pkg:@weave-framework/ui/expansion';
```

## Basic — value + onChange

Describe the panels as data (`{ id, header, body }`) and bind the **set of open ids** two-way with `value` +
`onChange`. Because open state is an array, several panels open at once (multi mode is the default).

:::demo ex-expansion-basic

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} value={{ open() }} onChange={{ setOpen }} />
<span>Open: {{ open().join(', ') || '(none)' }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Expansion from '@weave-framework/ui/expansion';

export function setup() {
  const open = signal(['shipping']); // ids of the open panels
  const panels = [
    { id: 'shipping', header: 'Shipping', body: 'Free over €50. Arrives in 2–4 business days.' },
    { id: 'returns', header: 'Returns', body: '30-day returns, no questions asked.' },
    { id: 'warranty', header: 'Warranty', body: 'Two-year limited warranty on every order.' },
  ];
  return { panels, open, setOpen: (v) => open.set(v) };
}
~~~
:::

## Single-open (accordion)

Set `multi={{ false }}` and opening one panel closes the others — the classic accordion.

:::demo ex-expansion-single

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} multi={{ false }} value={{ open() }} onChange={{ setOpen }} />
~~~
~~~ts title="app.ts"
const open = signal(['general']);
const panels = [
  { id: 'general', header: 'General', body: 'Language, theme and time-zone preferences.' },
  { id: 'privacy', header: 'Privacy', body: 'Who can see your profile and activity.' },
  { id: 'notifications', header: 'Notifications', body: 'Email and push alerts, per event type.' },
];
~~~
:::

## Uncontrolled — defaultOpen

Leave `value`/`onChange` off and the accordion tracks its own open state; `defaultOpen` seeds the initial set.

:::demo ex-expansion-default-open

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} defaultOpen={{ ['intro'] }} />
~~~
:::

## Disabled panel

A single panel's `disabled` flag makes it non-toggleable and skips it in keyboard navigation.

:::demo ex-expansion-disabled-panel

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} />
~~~
~~~ts title="app.ts"
const panels = [
  { id: 'free', header: 'Free plan', body: 'Everything you need to get started.' },
  { id: 'pro', header: 'Pro plan (coming soon)', body: 'Locked for now.', disabled: true },
  { id: 'team', header: 'Team plan', body: 'Shared workspaces and admin controls.' },
];
~~~
:::

## Disabled accordion

`disabled` on the component marks every header and blocks all toggling.

:::demo ex-expansion-disabled-all

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} defaultOpen={{ ['a'] }} disabled={{ true }} />
~~~
:::

## Heading level

Each header sits inside a `role="heading"` wrapper. `headingLevel` sets its `aria-level` so the accordion
nests correctly under your page's heading outline (default `3`).

:::demo ex-expansion-heading-level

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} headingLevel={{ 2 }} defaultOpen={{ ['q1'] }} />
~~~
:::

## Rich body content

A panel's `body` isn't limited to text — pass a DOM node or a factory `() => Node` and it's appended into the
region on mount.

:::demo ex-expansion-rich-body

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} defaultOpen={{ ['features'] }} />
~~~
~~~ts title="app.ts"
const panels = [
  { id: 'features', header: 'Features', body: () => {
    const ul = document.createElement('ul');
    for (const item of ['Signals', 'Templates', 'Zero deps']) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.append(li);
    }
    return ul;
  } },
];
~~~
:::

## Custom class

`class` is forwarded onto the container alongside `weave-expansion`, so you can hook your own styles on.

:::demo ex-expansion-custom-class

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} class={{ 'my-accordion' }} defaultOpen={{ ['one'] }} />
~~~
:::
