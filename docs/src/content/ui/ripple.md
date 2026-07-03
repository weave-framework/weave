# Ripple

The little ink splash that blooms from where you click. Ripple isn't a component — it's a Weave **`use:` action**
you attach to any surface, so you can give that Material-style click feedback to your own elements. `<Button>`
already uses it; this is how you add it anywhere else.

:::demo ripple-basic

## Import

```ts
import { ripple } from '@weave-framework/ui/ripple';
```

```scss
@use '@weave-framework/ui/ripple';
```

## Basic usage

An action lives in your component's `setup` scope, then you attach it in the template with `use:`. On pointer-down
it drops an expanding, fading circle at the click point and cleans it up when the animation ends:

:::tabs
~~~html title="app.html"
<div class="tile" use:ripple={{ opts }}>Click me</div>
~~~
~~~ts title="app.ts"
import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

export function setup() {
  // Return the action (so `use:` can find it) and its options object.
  const opts: RippleOptions = {}; // defaults
  return { ripple, opts };
}
~~~
:::

## Options

Pass options with `use:ripple={{ … }}`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `centered` | `boolean` | `false` | Emanate from the host's centre instead of the pointer — good for keyboard activation. |
| `disabled` | `boolean` | `false` | Suppress ripples without detaching the action. |

Hold the options in `setup` and pass them by name (the same way `<Button>` configures its own ripple):

:::tabs
~~~html title="app.html"
<div use:ripple={{ centered }}>Always ripples from the middle</div>
~~~
~~~ts title="app.ts"
import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

export function setup() {
  const centered: RippleOptions = { centered: true };
  return { ripple, centered };
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
