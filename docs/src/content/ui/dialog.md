# Dialog

A modal window for a focused task or a confirmation — it opens over a dimming backdrop, traps focus, and returns
focus to whatever opened it on close. You open a Dialog **imperatively** with `openDialog()`, which returns a handle
you can close (with a result) and await.

:::demo dialog-demo

## Import

```ts
import { openDialog } from '@weave-framework/ui/dialog';
```

```scss
@use '@weave-framework/ui/dialog';
```

## Basic usage

Call `openDialog()` with at least `content`. `title` adds a header (and wires `aria-labelledby`); `actions` is a
footer node for buttons. It returns a `DialogRef` — `close(result)`, and `afterClosed()` which resolves with that
result:

:::tabs
~~~html title="app.html"
<Button on:click={{ confirmDelete }}>Delete project…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

export function setup() {
  const confirmDelete = async () => {
    const ref = openDialog({
      title: 'Delete project?',
      content: 'This permanently removes the project. It cannot be undone.',
      role: 'alertdialog',
    });
    const result = await ref.afterClosed();
    if (result === 'deleted') { /* … */ }
  };
  return { confirmDelete };
}
~~~
:::

`content`, `header`, and `actions` accept a **string, a DOM node, or a factory** returning a node — so you can pass
plain text or build a rich body. The demo above wires two footer buttons that call `ref.close('deleted')` /
`ref.close()`.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `Node \| string \| () => Node` | — | **Required.** The body (scrolls when tall). |
| `title` | `string` | — | Convenience header text (wires `aria-labelledby`). |
| `header` | `ModalContent` | — | Custom header node (wins over `title`). |
| `actions` | `ModalContent` | — | Footer button area. |
| `width` / `height` | `number \| string` | 560px / auto | Preferred size (clamped to the viewport). |
| `role` | `'dialog' \| 'alertdialog'` | `'dialog'` | Use `alertdialog` for confirmations / destructive prompts. |
| `dismissable` | `boolean` | `true` | Esc + backdrop-click close. |
| `onClose` | `(result?) => void` | — | Called when the dialog closes, with the `close()` value. |

## The DialogRef

`openDialog()` returns a handle:

- `close(result?)` — close it, passing an optional result.
- `afterClosed()` — a Promise that resolves with the result (great for `await`ing a confirmation).
- `element` — the panel element.

## Accessibility

It's a real modal: `role="dialog"` (or `alertdialog`) with `aria-modal="true"`, focus moves inside on open and is
**restored to the opener** on close, Tab is trapped within, and the background is marked `inert` so assistive tech
can't wander out. Esc and backdrop-click close it (unless `dismissable: false`).
