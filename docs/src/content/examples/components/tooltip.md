# Tooltip — examples

Every feature of the `tooltip` action, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Tooltip reference page](/ui/tooltip); this page is just the examples,
covering the full option surface. Tooltip isn't a component — it's a Weave **`use:` action** you attach to any
element, so return it from `setup` and apply it with `use:tooltip`.

```ts
import { tooltip } from '@weave-framework/ui/tooltip';
```
```scss
@use '@weave-framework/ui/tooltip';
```

## Basic — a string hint

The simplest form: pass the text directly. It shows on **hover and on keyboard focus**, and hides on
blur / mouse-leave / Esc.

:::demo ex-tooltip-basic

:::tabs
~~~html title="app.html"
<button use:tooltip={{ 'Saves your work (⌘S)' }}>Hover or focus me</button>
~~~
~~~ts title="app.ts"
import { tooltip } from '@weave-framework/ui/tooltip';

export function setup() {
  // Return the action so `use:` can find it in the template.
  return { tooltip };
}
~~~
:::

## Position

`position` picks the preferred side (`'top'`, `'bottom'`, `'left'`, `'right'` — plus `-start`/`-end`
variants). It flips to the opposite side automatically when it would overflow. Pass an options object
instead of a bare string.

:::demo ex-tooltip-positions

:::tabs
~~~html title="app.html"
<button use:tooltip={{ top }}>Top</button>
<button use:tooltip={{ bottom }}>Bottom</button>
<button use:tooltip={{ left }}>Left</button>
<button use:tooltip={{ right }}>Right</button>
~~~
~~~ts title="app.ts"
export function setup() {
  return {
    tooltip,
    top: { text: 'Above', position: 'top' },
    bottom: { text: 'Below', position: 'bottom' },
    left: { text: 'To the left', position: 'left' },
    right: { text: 'To the right', position: 'right' },
  };
}
~~~
:::

## Delay

`delay` (ms) is the hover grace period before the tooltip appears — `0` shows instantly, a larger value
waits. Keyboard focus always shows immediately, regardless of `delay`, so it stays accessible.

:::demo ex-tooltip-delay

:::tabs
~~~html title="app.html"
<button use:tooltip={{ instant }}>Instant (delay 0)</button>
<button use:tooltip={{ slow }}>Slow (delay 800)</button>
~~~
~~~ts title="app.ts"
export function setup() {
  return {
    tooltip,
    instant: { text: 'No wait — shows at once', delay: 0 },
    slow: { text: 'Patient — waits 800ms on hover', delay: 800 },
  };
}
~~~
:::

## Disabled

`disabled` suppresses the tooltip without detaching the action. Because the options are signal-derived,
flipping it reconfigures the same host live — no re-attach.

:::demo ex-tooltip-disabled

:::tabs
~~~html title="app.html"
<button use:tooltip={{ opts() }}>Hover me — tooltip is {{ off() ? 'disabled' : 'enabled' }}</button>
<button onClick={{ toggle }}>{{ off() ? 'Enable tooltip' : 'Disable tooltip' }}</button>
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import { tooltip } from '@weave-framework/ui/tooltip';

export function setup() {
  const off = signal(false);
  const opts = computed(() => ({ text: 'Now you see me', disabled: off() }));
  return { tooltip, opts, off, toggle: () => off.set(!off()) };
}
~~~
:::

## On a composed component

The action attaches to a composed `<Button>` just as well — `use:` forwards to the button's root, so it
picks up hover and focus.

:::demo ex-tooltip-on-button

:::tabs
~~~html title="app.html"
<Button use:tooltip={{ 'Sends the message right away' }}>Send</Button>
<Button variant={{ 'ghost' }} use:tooltip={{ { text: 'This cannot be undone', position: 'bottom' } }}>Delete</Button>
~~~
~~~ts title="app.ts"
import { tooltip } from '@weave-framework/ui/tooltip';
import Button from '@weave-framework/ui/button';

export function setup() {
  return { tooltip };
}
~~~
:::
