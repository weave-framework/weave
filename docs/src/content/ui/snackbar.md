# Snackbar

A brief message that slides up from the bottom edge — "Saved", "Copied", "Message sent" — optionally with a single
action like **Undo**. You show one imperatively with `snackbar()`; they queue, so a burst of messages shows one at
a time.

:::demo snackbar-demo

## Import

```ts
import { snackbar } from '@weave-framework/ui/snackbar';
```

```scss
@use 'pkg:@weave-framework/ui/snackbar';
```

## Basic usage

Call `snackbar(message, options?)`. There's no backdrop, so the page stays interactive. It auto-dismisses after
`duration` (default 4s) and returns a handle you can dismiss or await:

:::tabs
~~~html title="app.html"
<Button on:click={{ save }}>Save</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

export function setup() {
  const save = () => {
    // …persist…
    snackbar('Project saved', { action: 'Undo' });
  };
  return { save };
}
~~~
:::

## An action

`action` is a single button — a `{ label, onAction }` object, or just a label string. Pressing it runs `onAction`
and dismisses the bar. Use it for a quick "Undo" or "Retry":

```ts
snackbar('Message archived', {
  action: { label: 'Undo', onAction: () => restore() },
});
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `action` | `{ label, onAction } \| string` | — | A single action button. |
| `duration` | `number` | `4000` | Auto-dismiss delay (ms). `0` = stays until dismissed. |
| `politeness` | `'polite' \| 'assertive'` | `'polite'` | Screen-reader urgency. |
| `position` | `'center' \| 'start' \| 'end'` | `'center'` | Horizontal placement along the bottom. `start` / `end` are logical — they follow the text direction. |

## The SnackbarRef

`snackbar()` returns `{ element, dismiss(), afterDismissed() }` — dismiss it early, or `await afterDismissed()` to
run something once it's gone.

## Accessibility

The message is announced to screen readers through a live region — `politeness: 'polite'` (default) waits for a
pause, `'assertive'` interrupts. Keep messages short and non-essential: a snackbar is transient, so never put
anything the user *must* act on only there. The action button is keyboard-reachable while the bar is shown, and the
auto-dismiss timer pauses while the bar is hovered or holds focus — so a slower reader doesn't lose the Undo.

## When it goes wrong

:::callout trap "`<Snackbar>` in a template renders nothing"
This one is **imperative**. There is no component to place — you call `snackbar` from an event handler and
it mounts itself into an overlay above your app.

~~~ts
import { snackbar } from '@weave-framework/ui/snackbar';
const open = (): void => { snackbar('Saved'); };
~~~

A capitalized tag that matches no import is a build error, so this fails loudly — but the error names a
missing component rather than the real problem, which is that there was never a component to import.
:::

**It opens and is unstyled.** The stylesheet is a separate import, per component:
`@use 'pkg:@weave-framework/ui/snackbar';` in your Sass. See [Installation](/ui/installation).

**It opens behind something.** Overlays render into the body, above the app, on purpose — so a
`z-index` war with an ancestor cannot clip them. If one is hidden, the thing covering it is also an
overlay, and the later one wins.
