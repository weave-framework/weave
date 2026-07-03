# Bottom Sheet

A panel that slides up from the bottom edge — the mobile-friendly cousin of the [Dialog](/ui/dialog). Same modal
behaviour (backdrop, focus-trap, focus-restore), but docked to the bottom and dismissable with a downward drag. You
open it imperatively with `openBottomSheet()`.

:::demo bottom-sheet-demo

## Import

```ts
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';
```

```scss
@use '@weave-framework/ui/bottom-sheet';
```

## Basic usage

Call `openBottomSheet()` with at least `content`. `title` adds a header; `actions` a footer. It returns a
`BottomSheetRef` (`close(result)`, `afterClosed()`) just like a Dialog:

:::tabs
~~~html title="app.html"
<Button on:click={{ share }}>Share…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const share = () => {
    openBottomSheet({
      title: 'Share',
      content: 'Copy a link, email it, or export a file.',
    });
  };
  return { share };
}
~~~
:::

`content`, `header`, and `actions` take a string, node, or factory — the same as Dialog.

## Drag to dismiss

By default the sheet shows a top grab-handle and a **downward drag** past a threshold closes it (releasing before
snaps it back). Turn it off with `dragToDismiss={{ false }}`.

## Dialog or Bottom Sheet?

They're the same modal primitive with a different dock:

- **[Dialog](/ui/dialog)** — centered; for focused tasks and confirmations, especially on desktop.
- **Bottom Sheet** — bottom-docked with drag-dismiss; natural on touch / mobile, or for a list of choices.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `Node \| string \| () => Node` | — | **Required.** The body (scrolls when tall). |
| `title` | `string` | — | Convenience header text. |
| `header` | `ModalContent` | — | Custom header node (wins over `title`). |
| `actions` | `ModalContent` | — | Footer button area. |
| `dismissable` | `boolean` | `true` | Esc + backdrop-click close. |
| `dragToDismiss` | `boolean` | `true` | Show a grab-handle and let a downward drag dismiss. |
| `onClose` | `(result?) => void` | — | Called when the sheet closes. |

## Accessibility

It's a modal like the Dialog — `role="dialog"` + `aria-modal="true"`, focus moves in and is restored to the opener
on close, Tab is trapped, and the background is `inert`. Esc and backdrop-click close it.
