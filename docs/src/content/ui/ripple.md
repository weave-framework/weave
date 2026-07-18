# Ripple

The little ink splash that blooms from where you click. Ripple isn't a component — it's a Weave **`use:` action**
you attach to any surface, so you can give that expanding click feedback to your own elements. `<Button>`
already uses it; this is how you add it anywhere else.

:::demo ripple-basic

## Import

```ts
import { ripple } from '@weave-framework/ui/ripple';
```

```scss
@use 'pkg:@weave-framework/ui/ripple';
```

## Basic usage

An action lives in your component's `setup` scope, then you attach it in the template with `use:`. On pointer-down
it drops an expanding, fading circle at the click point and cleans it up when the animation ends:

:::tabs
~~~html title="app.html"
<div class="tile" use:ripple>Click me</div>
~~~
~~~ts title="app.ts"
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  // Return the action so `use:` can find it. With no argument it uses the defaults.
  return { ripple };
}
~~~
:::

## Options

Pass options with `use:ripple={{ … }}`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `centered` | `boolean` | `false` | Emanate from the host's centre instead of the pointer — good for keyboard activation. |
| `disabled` | `boolean` | `false` | Suppress ripples without detaching the action. |

Write the options inline as an object literal — the double braces are the `use:` binding delimiters wrapping a plain `{ … }` object:

:::tabs
~~~html title="app.html"
<div use:ripple={{ { centered: true } }}>Always ripples from the middle</div>
~~~
~~~ts title="app.ts"
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  return { ripple };
}
~~~
:::

The options object is handed to the action once, when it attaches — swapping in a *different* object later won't
reconfigure it. Both `centered` and `disabled` are read fresh at each pointer-down, though, so to change the
behaviour over time keep **one** object in `setup` and let it answer differently. That's exactly how `<Button>`
suppresses its own ripple while disabled:

:::tabs
~~~html title="app.html"
<div use:ripple={{ opts }}>Quiet while busy</div>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  const busy = signal(false);
  // A stable object with a live getter — read on every pointer-down.
  const opts = {
    get disabled() {
      return busy();
    },
  };
  return { ripple, opts, busy };
}
~~~
:::

## The host

The ripple is absolutely positioned and must be clipped, so the action nudges the host for you if needed — it sets
`position: relative` when the host is `static`, and `overflow: hidden` when it's `visible`. You can set those
yourself (or use the `weave.ripple-host` Sass mixin) if you'd rather be explicit.

:::callout tip "Respects reduced motion"
Under `prefers-reduced-motion: reduce`, the ripple is skipped entirely — no animation is drawn.
:::

## Accessibility

The ripple is purely decorative: each circle is `aria-hidden` and carries no meaning, so it never reaches assistive
tech. It's feedback for the eye only — make sure the host itself is a real, focusable control (a `<button>`, a link)
so the interaction is reachable by keyboard.
