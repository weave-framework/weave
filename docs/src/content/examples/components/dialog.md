# Dialog — examples

Every option of `openDialog()`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Dialog reference page](/ui/dialog); this page is just the examples,
covering the full service surface. A Dialog is opened **imperatively** — you call `openDialog(options)` from an
event handler, not by placing a tag in the template.

```ts
import { openDialog } from '@weave-framework/ui/dialog';
```
```scss
@use 'pkg:@weave-framework/ui/dialog';
```

## Basic — title + content

The minimum: `openDialog()` with a `content` body. Add `title` for a header (it also wires `aria-labelledby`).
It's dismissable by default — Esc or a backdrop click closes it.

:::demo ex-dialog-basic

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open dialog</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

export function setup() {
  const open = () => {
    openDialog({
      title: 'Welcome',
      content: 'This is a modal dialog. Press Esc, click the backdrop, or wait — it dismisses itself.',
    });
  };
  return { open };
}
~~~
:::

## Actions footer

`actions` is a footer node for buttons. It's fixed while the body scrolls. Wire each button to
`ref.close(result)` once you hold the returned `DialogRef`.

:::demo ex-dialog-actions

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Rename file…</Button>
~~~
~~~ts title="app.ts"
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

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

    const ref = openDialog({ title: 'Rename file', content: '…', actions });
    cancel.onclick = () => ref.close();
    save.onclick = () => ref.close('saved');
  };
  return { open };
}
~~~
:::

## Alert dialog — role

`role: 'alertdialog'` marks a confirmation or destructive prompt so assistive tech announces it with the
right urgency.

:::demo ex-dialog-alert

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Delete project…</Button>
~~~
~~~ts title="app.ts"
const ref = openDialog({
  title: 'Delete project?',
  content: 'This permanently removes the project and all its data. It cannot be undone.',
  role: 'alertdialog',
  actions,
});
cancel.onclick = () => ref.close();
del.onclick = () => ref.close('deleted');
~~~
:::

## Awaiting the result — afterClosed()

`openDialog()` returns a `DialogRef`. `afterClosed()` is a Promise that resolves with the value passed to
`close(result)` — perfect for `await`ing a confirmation.

:::demo ex-dialog-result

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Ask me</Button>
<span>You chose: {{ choice() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { openDialog } from '@weave-framework/ui/dialog';

export function setup() {
  const choice = signal('(not answered yet)');
  const open = async () => {
    const ref = openDialog({ title: 'Enable notifications?', content: '…', actions });
    no.onclick = () => ref.close('declined');
    yes.onclick = () => ref.close('accepted');
    const result = await ref.afterClosed();
    choice.set(typeof result === 'string' ? result : 'dismissed');
  };
  return { open, choice };
}
~~~
:::

## onClose callback

`onClose` fires with the `close(result)` value — an alternative to `afterClosed()` for a fire-and-forget
handler. It runs whether the dialog was closed by a button, Esc, or a backdrop click.

:::demo ex-dialog-onclose

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Open</Button>
<span>Last close: {{ last() }}</span>
~~~
~~~ts title="app.ts"
const last = signal('—');
openDialog({
  title: 'Close me any way you like',
  content: '…',
  onClose: (result) => last.set(result === undefined ? 'dismissed (no result)' : String(result)),
});
~~~
:::

## Custom header node

A `header` DOM node wins over the `title` string, so you can put icons, badges, or layout in the title bar.

:::demo ex-dialog-header

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Custom header</Button>
~~~
~~~ts title="app.ts"
const header = document.createElement('div');
header.style.cssText = 'display:flex; align-items:center; gap:10px; font-weight:600;';
header.innerHTML = '<span aria-hidden="true">🎉</span><span>You\'re on the list!</span>';

openDialog({ header, content: 'A header node lets you put icons or layout in the title bar.' });
~~~
:::

## Rich content — node / factory

`content` (like `header` and `actions`) accepts a **string, a DOM node, or a `() => Node` factory**, so the
body can be arbitrarily rich markup.

:::demo ex-dialog-node-content

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>What's new</Button>
~~~
~~~ts title="app.ts"
openDialog({
  title: 'Release notes',
  content: () => {
    const body = document.createElement('div');
    body.innerHTML = '<p>Version 2.0 is here:</p><ul><li>Signal-native</li><li>Zero deps</li></ul>';
    return body;
  },
});
~~~
:::

## Preferred size — width / height

`width` and `height` set the preferred size (number → px, string passes through). Both stay clamped to the
viewport; when the body overflows the fixed height, only the content region scrolls.

:::demo ex-dialog-size

:::tabs
~~~html title="app.html"
<Button on:click={{ openWide }}>Wide</Button>
<Button on:click={{ openTall }}>Tall &amp; scrolling</Button>
~~~
~~~ts title="app.ts"
openDialog({ title: 'Wide (860px)', content: '…', width: 860 });
openDialog({ title: 'Tall (60vh)', content: longBody, height: '60vh' });
~~~
:::

## Non-dismissable

`dismissable: false` ignores Esc and backdrop clicks — the user has to pick an action. Programmatic
`ref.close()` still works.

:::demo ex-dialog-nondismissable

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>Force a choice</Button>
~~~
~~~ts title="app.ts"
const ref = openDialog({
  title: 'Action required',
  content: 'Try Esc or clicking outside — nothing happens. You have to make a choice.',
  dismissable: false,
  actions,
});
ok.onclick = () => ref.close('acknowledged');
~~~
:::
