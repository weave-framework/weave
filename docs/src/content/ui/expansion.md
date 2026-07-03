# Expansion Panel

Collapsible sections — an FAQ, a settings group, anything you want to fold away until needed. Each panel has a
header you click to reveal its body; open several at once, or switch to single-open accordion mode.

:::demo expansion-demo

## Import

```ts
import Expansion from '@weave-framework/ui/expansion';
```

```scss
@use '@weave-framework/ui/expansion';
```

## Basic usage

Describe the panels as data — each `{ id, header, body }` — and bind the **set of open ids** with `value` +
`onChange`. `body` is a string, DOM node, or factory:

:::tabs
~~~html title="app.html"
<Expansion panels={{ panels }} value={{ open() }} onChange={{ setOpen }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Expansion from '@weave-framework/ui/expansion';

export function setup() {
  const open = signal(['shipping']); // ids of the open panels
  const panels = [
    { id: 'shipping', header: 'Shipping', body: 'Free over €50.' },
    { id: 'returns', header: 'Returns', body: '30-day returns.' },
    { id: 'warranty', header: 'Warranty', body: 'Two-year warranty.' },
  ];
  return { panels, open, setOpen: (v) => open.set(v) };
}
~~~
:::

Because the open state is an **array of ids**, several panels can be open at once. Leave `value` off and use
`defaultOpen` for an uncontrolled accordion.

## Single-open (accordion)

Set `multi={{ false }}` and opening one panel closes the others — the classic accordion:

```html
<Expansion panels={{ panels }} multi={{ false }} value={{ open() }} onChange={{ setOpen }} />
```

## Accessibility

Each header is a `<button aria-expanded aria-controls>` inside a heading of the level you set (`headingLevel`,
default 3); its body is a `role="region"` labelled by the header, and a closed region is `inert` + `aria-hidden`.
**Up / Down / Home / End** move header focus (skipping disabled), Enter / Space toggle.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `panels` | `ExpansionPanel[]` | — | The panels, each `{ id, header, body, disabled? }`. |
| `multi` | `boolean` | `true` | Independent panels (`false` = single-open accordion). |
| `value` | `string[]` | — | Controlled open set (ids). Ignored when uncontrolled. |
| `onChange` | `(open: string[]) => void` | — | Called with the next open set on toggle. |
| `defaultOpen` | `string[]` | `[]` | Uncontrolled initial open set. |
| `headingLevel` | `number` | `3` | ARIA heading level for the headers. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
