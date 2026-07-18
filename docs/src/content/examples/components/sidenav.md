# Sidenav — examples

Every feature of `<Sidenav>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Sidenav reference page](/ui/sidenav); this page is just the examples,
covering the full component surface.

```ts
import Sidenav from '@weave-framework/ui/sidenav';
```
```scss
@use 'pkg:@weave-framework/ui/sidenav';
```

## Basic — side mode + slots

The layout shell: put the drawer content in the `drawer` slot and the page in the default slot. In
`side` mode the drawer is in flow and pushes the content over.

:::demo ex-sidenav-basic

:::tabs
~~~html title="app.html"
<Sidenav mode={{ 'side' }} defaultOpened={{ true }}>
  <nav slot="drawer">…navigation…</nav>
  <div>…main content…</div>
</Sidenav>
~~~
~~~ts title="app.ts"
import Sidenav from '@weave-framework/ui/sidenav';

export function setup() {
  return {};
}
~~~
:::

## Modes — side, over, push

`mode` fixes the layout. `side` keeps the drawer in flow; `over` floats it above the content with a
dimming backdrop (a modal context — Esc + backdrop close); `push` floats it **and** shifts the content
across.

:::demo ex-sidenav-modes

:::tabs
~~~html title="app.html"
<Sidenav mode={{ mode() }} opened={{ opened() }} onOpenedChange={{ setOpened }}>
  <nav slot="drawer">Mode: {{ mode() }}</nav>
  <div>Content in {{ mode() }} mode.</div>
</Sidenav>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Sidenav, { type SidenavMode } from '@weave-framework/ui/sidenav';

export function setup() {
  const mode = signal<SidenavMode>('over');
  const opened = signal(true);
  return {
    mode,
    opened,
    setOpened: (v) => opened.set(v),
    pick: (m) => { mode.set(m); opened.set(true); },
  };
}
~~~
:::

## Controlled — opened + onOpenedChange

Drive `opened` from your own signal and update it in `onOpenedChange`. The backdrop and Esc request a
close *through* `onOpenedChange`, so your signal stays the single source of truth.

:::demo ex-sidenav-controlled

:::tabs
~~~html title="app.html"
<Button on:click={{ toggle }}>{{ open() ? 'Close' : 'Open' }} menu</Button>

<Sidenav mode={{ 'over' }} opened={{ open() }} onOpenedChange={{ setOpen }}>
  <nav slot="drawer">…menu…</nav>
  <div>…page…</div>
</Sidenav>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const open = signal(false);
  return {
    open,
    setOpen: (v) => open.set(v),
    toggle: () => open.set((o) => !o),
  };
}
~~~
:::

## Imperative handle — api

Grab `{ open, close, toggle, opened }` via the `api` ref callback and drive the drawer from anywhere —
the classic toolbar-hamburger pattern, no controlled signal required.

:::demo ex-sidenav-api

:::tabs
~~~html title="app.html"
<Button on:click={{ open }}>open()</Button>
<Button on:click={{ close }} variant={{ 'outline' }}>close()</Button>
<Button on:click={{ toggle }} variant={{ 'ghost' }}>toggle()</Button>

<Sidenav mode={{ 'over' }} defaultOpened={{ false }} api={{ onApi }}>
  <nav slot="drawer">…drawer…</nav>
  <div>…page…</div>
</Sidenav>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import { type SidenavApi } from '@weave-framework/ui/sidenav';

export function setup() {
  const api = signal<SidenavApi | null>(null);
  return {
    onApi: (a) => api.set(a),
    open: () => api()?.open(),
    close: () => api()?.close(),
    toggle: () => api()?.toggle(),
  };
}
~~~
:::

## Position — end edge

`position={{ 'end' }}` docks the drawer to the trailing edge instead of the default `'start'`.

:::demo ex-sidenav-position

:::tabs
~~~html title="app.html"
<Sidenav mode={{ 'side' }} position={{ 'end' }} defaultOpened={{ true }}>
  <nav slot="drawer">…inspector…</nav>
  <div>…page…</div>
</Sidenav>
~~~
:::

## Backdrop — force the scrim

`backdrop` forces the dimming scrim on (or off), independent of mode. Here a `push` drawer — which
normally has no backdrop — gets one; `backdrop={{ false }}` would suppress it in `over` mode.

:::demo ex-sidenav-backdrop

:::tabs
~~~html title="app.html"
<Sidenav mode={{ 'push' }} backdrop={{ true }} opened={{ open() }} onOpenedChange={{ setOpen }}>
  <nav slot="drawer">…drawer…</nav>
  <div>…page…</div>
</Sidenav>
~~~
:::

## Responsive — omit mode + breakpoint

Omit `mode` for the responsive shell: it reads the CDK breakpoint and is `side` + open when wide,
`over` + closed when narrow. `breakpoint` overrides the media query (default: the Narrow 900px).

:::demo ex-sidenav-responsive

:::tabs
~~~html title="app.html"
<Sidenav breakpoint={{ '(max-width: 700px)' }}>
  <nav slot="drawer">…navigation…</nav>
  <div>…page…</div>
</Sidenav>
~~~
:::

## Custom class

`class` is forwarded onto the root element, so you can hook your own styles onto the shell alongside the
built-in `weave-sidenav` classes.

:::demo ex-sidenav-class

:::tabs
~~~html title="app.html"
<Sidenav mode={{ 'side' }} defaultOpened={{ true }} class={{ 'app-shell' }}>
  <nav slot="drawer">…navigation…</nav>
  <div>…page…</div>
</Sidenav>
~~~
:::
