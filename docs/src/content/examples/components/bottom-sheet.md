# Bottom Sheet — examples

Every option of `openBottomSheet()`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Bottom Sheet reference page](/ui/bottom-sheet); this page is just
the examples, covering the full option surface. A Bottom Sheet is opened **imperatively** with a service call
(not a `<Tag>`), so each demo wires a `<Button>` trigger to a handler that calls `openBottomSheet()`.

```ts
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';
```
```scss
@use '@weave-framework/ui/bottom-sheet';
```

## Basic — title + content

The minimal call: a `title` string for the header and a string `content` for the body. It slides up from the
bottom edge with a grab-handle, backdrop, and focus-trap.

:::demo ex-bottom-sheet-basic

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Share…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    openBottomSheet({
      title: 'Share',
      content: 'Choose how to share this — copy a link, email it, or export a file.',
    });
  };
  return { open };
}
~~~
:::

## Actions footer + close(result)

`actions` renders a footer button area. Build the row first, open the sheet, then wire each button to
`ref.close(result)` — the result is threaded through `onClose` / `afterClosed()`.

:::demo ex-bottom-sheet-actions

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Edit filter…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.className = 'weave-button weave-button--outline';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.className = 'weave-button';
    actions.append(cancel, save);

    const ref = openBottomSheet({
      title: 'Edit filter',
      content: 'Adjust the filter, then Save to apply it or Cancel to discard.',
      actions,
    });
    cancel.onclick = () => ref.close();
    save.onclick = () => ref.close('saved');
  };
  return { open };
}
~~~
:::

## Custom header node

Pass a DOM node as `header` for a richer heading. A `header` node **wins over** the `title` string.

:::demo ex-bottom-sheet-header

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open with custom header…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:8px;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px; height:10px; border-radius:50%; background:var(--accent, #4f46e5);';
    const label = document.createElement('strong');
    label.textContent = 'Live status';
    header.append(dot, label);

    openBottomSheet({
      header, // wins over the title string
      title: 'ignored when header is set',
      content: 'The custom header node renders instead of the plain title string.',
    });
  };
  return { open };
}
~~~
:::

## Content as a factory

`content` (like `header` and `actions`) accepts a string, a node, or a **factory** `() => Node` built lazily
when the sheet opens.

:::demo ex-bottom-sheet-content-factory

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open action list…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    openBottomSheet({
      title: 'Choose an action',
      content: () => {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
        for (const name of ['Copy link', 'Send email', 'Export file']) {
          const item = document.createElement('button');
          item.type = 'button';
          item.textContent = name;
          item.className = 'weave-button weave-button--outline';
          list.append(item);
        }
        return list;
      },
    });
  };
  return { open };
}
~~~
:::

## Tall content scrolls

The panel never exceeds the viewport — when the body is tall, the content region scrolls while the header,
handle, and actions stay pinned.

:::demo ex-bottom-sheet-scrolling

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open long content…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    for (let i = 1; i <= 30; i++) {
      const row = document.createElement('p');
      row.style.margin = '0';
      row.textContent = `Line ${i} — the panel is capped, so this list scrolls.`;
      body.append(row);
    }
    openBottomSheet({ title: 'Terms', content: body });
  };
  return { open };
}
~~~
:::

## Non-dismissable

`dismissable={{ false }}` turns off Esc + backdrop-click close, so the user must act on an explicit button.

:::demo ex-bottom-sheet-non-dismissable

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open non-dismissable…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; justify-content:flex-end;';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Got it';
    done.className = 'weave-button';
    actions.append(done);

    const ref = openBottomSheet({
      title: 'Please confirm',
      content: 'Esc and backdrop-click are disabled — the only way out is the button.',
      dismissable: false,
      actions,
    });
    done.onclick = () => ref.close();
  };
  return { open };
}
~~~
:::

## Disable drag-to-dismiss

By default the sheet shows a grab-handle and a downward drag past a threshold closes it.
`dragToDismiss={{ false }}` hides the handle and disables the drag gesture.

:::demo ex-bottom-sheet-no-drag

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open without drag…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const open = () => {
    openBottomSheet({
      title: 'No handle',
      content: 'The grab-handle is gone and a downward drag no longer closes the sheet.',
      dragToDismiss: false,
    });
  };
  return { open };
}
~~~
:::

## onClose callback

`onClose(result)` fires when the sheet closes — with the `close(result)` value, or `undefined` on a
dismiss. Here it drives a signal shown next to the trigger.

:::demo ex-bottom-sheet-on-close

:::tabs
~~~html title="app.html"
<div style="display:flex; align-items:center; gap:12px;">
  <Button on:click={{ open }}>Respond…</Button>
  <span>Last result: {{ last() }}</span>
</div>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const last = signal('—');
  const open = () => {
    // …build Accept / Decline buttons into `actions`…
    const ref = openBottomSheet({
      title: 'Invitation',
      content: 'Accept or decline — reported back through onClose.',
      actions,
      onClose: (result) => last.set(result == null ? 'dismissed' : String(result)),
    });
    no.onclick = () => ref.close('declined');
    yes.onclick = () => ref.close('accepted');
  };
  return { last, open };
}
~~~
:::

## Awaiting afterClosed()

The returned `BottomSheetRef` also exposes `afterClosed()`, a promise that resolves with the `close(result)`
value — handy for `await`-style flows.

:::demo ex-bottom-sheet-after-closed

:::tabs
~~~html title="app.html"
<div style="display:flex; align-items:center; gap:12px;">
  <Button on:click={{ open }}>Delete…</Button>
  <span>Status: {{ status() }}</span>
</div>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

export function setup() {
  const status = signal('idle');
  const open = async () => {
    // …build a Delete button into `actions`…
    const ref = openBottomSheet({
      title: 'Delete item?',
      content: 'Confirm to delete. We await afterClosed() and act on the result.',
      actions,
    });
    del.onclick = () => ref.close('deleted');

    status.set('waiting…');
    const result = await ref.afterClosed();
    status.set(result === 'deleted' ? 'deleted' : 'kept');
  };
  return { status, open };
}
~~~
:::
