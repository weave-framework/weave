# Dialog

A modal window for a focused task or a confirmation — it opens over a dimming backdrop, traps focus, and returns
focus to whatever opened it on close. You open a Dialog **imperatively** with `openDialog()`, which returns a handle
you can close (with a result) and await.

:::demo dialog-demo

## Import

```ts
import { openDialog, component } from '@weave-framework/ui/dialog';
```

```scss
@use 'pkg:@weave-framework/ui/dialog';
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

`content`, `header`, and `actions` are each a `DialogContent` — **a string, a DOM node, a factory** returning a
node, **or a `[Component, props?]` tuple** (`Node | string | () => Node | [Component, Props]`) — so you can pass
plain text, build a rich body, or hand over a whole component. The demo above wires two footer buttons that call
`ref.close('deleted')` / `ref.close()`.

The header and actions regions only exist when you supply them: omit `header` *and* `title` and there's no header
region; omit `actions` and there's no footer. `content` is mandatory and is the only region that scrolls.

### A component as content

Most editors are a form inside a dialog. Hand `openDialog` the component directly — as a `[Component, props]` tuple,
or the `component()` helper for a readable call site — and it is **mounted under its own owner and disposed when the
dialog closes**. Its `onMount`, `effect`s and `onDispose` all run; a prop that is a signal keeps the region live:

~~~ts title="edit-season.ts"
import { openDialog, component } from '@weave-framework/ui/dialog';
import SeasonEditor from './season-editor.js'; // a normal weave component

export function setup() {
  const editSeason = async (season) => {
    const ref = openDialog({
      title: 'Edit season',
      content: component(SeasonEditor, { season }), // or the tuple: [SeasonEditor, { season }]
      // actions: component(EditorActions, { onSave }),
    });
    const saved = await ref.afterClosed();
    if (saved) { /* … */ }
  };
  return { editSeason };
}
~~~

There is **no adapter to write** — `openDialog` already owns the open/close lifecycle, and the component's
mount/dispose lifecycle rides the same path. A bare `() => Node` factory is unchanged: it is still called once,
without an owner, so nothing existing behaves differently.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `DialogContent` | — | **Required.** The body (scrolls when tall). |
| `title` | `string` | — | Convenience header text (wires `aria-labelledby`). |
| `header` | `DialogContent` | — | Custom header node (wins over `title`). |
| `actions` | `DialogContent` | — | Footer button area. |
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

It's a real modal: `role="dialog"` (or `alertdialog`) with `aria-modal="true"`. Whichever way you supply the header
(`header` or `title`) it becomes the dialog's `aria-labelledby`, and the content region is always its
`aria-describedby`. Focus moves inside on open and is
**restored to the opener** on close, Tab is trapped within, and the background is marked `inert` so assistive tech
can't wander out. Esc and backdrop-click close it (unless `dismissable: false`).
