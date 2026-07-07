# Ripple — examples

Every feature of the `ripple` action, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Ripple reference page](/ui/ripple); this page is just the examples,
covering the full option surface. Ripple isn't a component — it's a Weave **`use:` action** you attach to any
surface, so return it from `setup` and reference it in the template with `use:ripple`.

```ts
import { ripple } from '@weave-framework/ui/ripple';
```
```scss
@use '@weave-framework/ui/ripple';
```

## Basic — from the pointer

With no options the ripple blooms from wherever you press. Return the action from `setup` so `use:` can find
it, then attach it to any clickable surface.

:::demo ex-ripple-basic

:::tabs
~~~html title="app.html"
<div use:ripple>Click anywhere for a ripple</div>
~~~
~~~ts title="app.ts"
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  // Return the action so `use:` can find it. With no argument it uses the defaults.
  return { ripple };
}
~~~
:::

## Centered

`centered: true` ignores the pointer position and always emanates from the host's middle — the right feel for
keyboard activation, where there's no click point. The double braces are the `use:` binding delimiters wrapping
a plain `{ … }` options object.

:::demo ex-ripple-centered

:::tabs
~~~html title="app.html"
<div use:ripple={{ { centered: true } }}>Always ripples from the centre</div>
~~~
~~~ts title="app.ts"
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  return { ripple };
}
~~~
:::

## Disabled

`disabled: true` suppresses ripples without detaching the action, so you can leave the `use:` binding in place
and gate the feedback on state instead of adding and removing the action.

:::demo ex-ripple-disabled

:::tabs
~~~html title="app.html"
<div use:ripple={{ { disabled: true } }}>Ripple suppressed (disabled)</div>
~~~
~~~ts title="app.ts"
import { ripple } from '@weave-framework/ui/ripple';

export function setup() {
  return { ripple };
}
~~~
:::

## Reactive options

Options can be a signal-derived object, so the ripple reconfigures live. Here a checkbox flips `disabled` on
the same host — no re-attach — while `centered` stays on. `use:ripple={{ opts() }}` reads whatever the getter
returns on each pointer-down.

:::demo ex-ripple-reactive

:::tabs
~~~html title="app.html"
<div use:ripple={{ opts() }}>Centred ripple — {{ off() ? 'disabled' : 'enabled' }}</div>
<button type="button" onClick={{ toggle }}>{{ off() ? 'Enable ripples' : 'Suppress ripples' }}</button>
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

export function setup() {
  const off = signal(false);
  const opts = computed<RippleOptions>(() => ({ centered: true, disabled: off() }));
  return { ripple, opts, off, toggle: () => off.set(!off()) };
}
~~~
:::
