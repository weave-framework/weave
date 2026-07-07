# Snackbar — examples

Every feature of `snackbar()`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Snackbar reference page](/ui/snackbar); this page is just the examples,
covering the full option surface. Unlike most components, a snackbar is shown **imperatively** — you call
`snackbar(message, options?)` from a handler, not by rendering a tag.

```ts
import { snackbar } from '@weave-framework/ui/snackbar';
```
```scss
@use '@weave-framework/ui/snackbar';
```

## Basic — message + action

Call `snackbar(message, options?)` from a click handler. It auto-dismisses after `duration` (default 4s).
A string `action` is a label-only button.

:::demo ex-snackbar-basic

:::tabs
~~~html title="app.html"
<Button on:click={{ save }}>Save</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const save = () => {
    snackbar('Project saved', { action: 'Undo' });
  };
  return { save };
}
~~~
:::

## Action with a callback

Pass `action` as an `{ label, onAction }` object and `onAction` fires when the button is clicked (the bar
also dismisses). Use it for a quick "Undo" or "Retry".

:::demo ex-snackbar-action

:::tabs
~~~html title="app.html"
<Button on:click={{ archive }}>Archive</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const archive = () => {
    snackbar('Message archived', {
      action: { label: 'Undo', onAction: () => snackbar('Restored') },
    });
  };
  return { archive };
}
~~~
:::

## Duration — timed & sticky

`duration` is the auto-dismiss delay in ms. `0` keeps the bar up until something dismisses it — here the
returned `SnackbarRef.dismiss()` is called after 2s.

:::demo ex-snackbar-duration

:::tabs
~~~html title="app.html"
<Button on:click={{ quick }}>Quick (1s)</Button>
<Button on:click={{ sticky }}>Sticky (duration 0)</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const quick = () => snackbar('Gone in a second', { duration: 1000 });
  const sticky = () => {
    const ref = snackbar('Stays until dismissed', { duration: 0 });
    setTimeout(() => ref.dismiss(), 2000);
  };
  return { quick, sticky };
}
~~~
:::

## Position

`position` places the bar along the bottom edge: `'center'` (default), `'start'`, or `'end'`. `start` and
`end` are logical, so they flip in RTL.

:::demo ex-snackbar-positions

:::tabs
~~~html title="app.html"
<Button on:click={{ start }}>Start</Button>
<Button on:click={{ center }}>Center</Button>
<Button on:click={{ end }}>End</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  return {
    start: () => snackbar('Bottom start', { position: 'start' }),
    center: () => snackbar('Bottom center', { position: 'center' }),
    end: () => snackbar('Bottom end', { position: 'end' }),
  };
}
~~~
:::

## Politeness

`politeness` sets the screen-reader urgency of the live-region announcement: `'polite'` (default, waits for
a pause) or `'assertive'` (interrupts). The bar looks identical — the difference is heard, not seen.

:::demo ex-snackbar-politeness

:::tabs
~~~html title="app.html"
<Button on:click={{ polite }}>Polite</Button>
<Button on:click={{ assertive }}>Assertive</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  return {
    polite: () => snackbar('Draft saved', { politeness: 'polite' }),
    assertive: () => snackbar('Connection lost', { politeness: 'assertive' }),
  };
}
~~~
:::

## The SnackbarRef — dismiss & afterDismissed

`snackbar()` returns `{ element, dismiss(), afterDismissed() }`. `afterDismissed()` resolves once the bar is
gone, so you can chain a follow-up.

:::demo ex-snackbar-ref

:::tabs
~~~html title="app.html"
<Button on:click={{ run }}>Upload</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const run = () => {
    const ref = snackbar('Uploading…', { duration: 1500 });
    ref.afterDismissed().then(() => snackbar('Upload complete'));
  };
  return { run };
}
~~~
:::

## Queueing — one at a time

Only one snackbar is visible at a time; concurrent calls queue and show in turn. Fire three at once and
watch them drain one by one.

:::demo ex-snackbar-queue

:::tabs
~~~html title="app.html"
<Button on:click={{ burst }}>Fire three</Button>
~~~
~~~ts title="app.ts"
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const burst = () => {
    snackbar('First', { duration: 1500 });
    snackbar('Second', { duration: 1500 });
    snackbar('Third', { duration: 1500 });
  };
  return { burst };
}
~~~
:::
