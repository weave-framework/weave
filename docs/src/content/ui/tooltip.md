# Tooltip

A small label that appears on hover or focus to explain a control. Tooltip isn't a component — it's a Weave
**`use:` action** you attach to any element, so an icon button or a truncated label can carry a hint without any
extra markup.

:::demo tooltip-demo

## Import

```ts
import { tooltip } from '@weave-framework/ui/tooltip';
```

```scss
@use 'pkg:@weave-framework/ui/tooltip';
```

## Basic usage

Return the action from `setup`, then attach it with `use:`. Pass the text directly — the simplest form is a string:

:::tabs
~~~html title="app.html"
<button use:tooltip={{ 'Saves your work (⌘S)' }}>Save</button>
~~~
~~~ts title="app.ts"
import { tooltip } from '@weave-framework/ui/tooltip';

export function setup() {
  // Return the action so `use:` can find it in the template.
  return { tooltip };
}
~~~
:::

The tooltip shows on **hover and on keyboard focus**, and hides on blur / mouse-leave / Esc — so it's reachable
without a mouse.

## Options

Instead of a bare string, pass an options object for more control (placement, delay, and so on):

```html
<button use:tooltip={{ tip }}>Delete</button>
```

```ts
export function setup() {
  const tip = { text: 'Deletes forever', position: 'bottom', delay: 400 };
  return { tooltip, tip };
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | `string` | — | The hint text. Plain string — a tooltip is non-interactive. |
| `position` | `PositionName` | `'top'` | Preferred side; flips to the opposite one when it would overflow. |
| `delay` | `number` | `150` | Delay (ms) before **hover** shows it. Focus always shows with no delay. |
| `disabled` | `boolean` | `false` | Suppress the tooltip without detaching the action. |

`position` takes any of the CDK position names — `'top'`, `'bottom'`, `'left'`, `'right'`, and their
`-start` / `-end` variants (`'bottom-start'`, `'right-end'`, …).

## Accessibility

A tooltip supplements a control that already has its own accessible name — it's a hint, not the label. Keep the
element itself meaningful (real button text, or an `aria-label` on an icon button), and use the tooltip for the
extra detail. It appears on focus as well as hover, so keyboard users get it too.

It follows the WAI-ARIA tooltip pattern: the panel is `role="tooltip"`, and while it's shown the host carries an
`aria-describedby` pointing at it — so the hint reaches assistive tech as the trigger's *description*, not its name.
The panel itself is never focused and never captures the pointer.

:::callout warn "Not for essential information"
Don't hide anything the user *must* have inside a tooltip — it's transient and unavailable on touch. Use it for
helpful extras, not required content.
:::
