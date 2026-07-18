# Icon — examples

Every feature of `<Icon>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Icon reference page](/ui/icon); this page is just the examples,
covering the full component surface.

```ts
import Icon from '@weave-framework/ui/icon';
```
```scss
@use 'pkg:@weave-framework/ui/icon';
```

## Basic — name

`name` looks the glyph up in the active registry — the built-in [Lucide](https://lucide.dev) set by
default. No per-icon import and no async wait; the bundled set resolves synchronously.

:::demo ex-icon-name

:::tabs
~~~html title="app.html"
<Icon name={{ 'search' }} />
<Icon name={{ 'house' }} />
<Icon name={{ 'user' }} />
<Icon name={{ 'mail' }} />
<Icon name={{ 'calendar' }} />
<Icon name={{ 'settings' }} />
~~~
:::

## Colour — currentColor

An icon is drawn in `currentColor`, so it inherits the text colour of whatever contains it — set the
colour on a parent and the icon follows. That's why an `<Icon>` inside a `<Button>` matches the button's
text with no per-icon colour.

:::demo ex-icon-color

:::tabs
~~~html title="app.html"
<span style="color:#2d7a4e"><Icon name={{ 'circle-check' }} /></span>
<span style="color:#c0392b"><Icon name={{ 'circle-alert' }} /></span>
<span style="color:#b45309"><Icon name={{ 'triangle-alert' }} /></span>
<span style="color:#2563eb"><Icon name={{ 'info' }} /></span>
~~~
:::

## Inline SVG — svg

`svg` renders a complete `<svg>…</svg>` string directly, bypassing the registry — use it for one-off
markup you already have. The string is sanitised before it hits the DOM (`<script>`, `<foreignObject>`,
`on*` handlers and `javascript:` URLs are stripped), and it still draws in `currentColor`.

:::demo ex-icon-svg

:::tabs
~~~html title="app.html"
<Icon svg={{ mySvg }} />
<span style="color:#7c3aed"><Icon svg={{ mySvg }} /></span>
~~~
~~~ts title="app.ts"
export function setup() {
  const mySvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>';
  return { mySvg };
}
~~~
:::

## Remote file — src

`src` fetches a standalone `.svg` file and renders it, reactively (a new `src` cancels the last fetch).
Remote markup is untrusted, so it's sanitised on the way in. The example below uses a `data:` URL so it's
self-contained; in an app you'd point at a path like `'/icons/brand.svg'`.

:::demo ex-icon-src

:::tabs
~~~html title="app.html"
<Icon src={{ url }} />
<span style="color:#2d7a4e"><Icon src={{ url }} /></span>
~~~
~~~ts title="app.ts"
export function setup() {
  const url = '/icons/brand.svg'; // any URL to a standalone .svg file
  return { url };
}
~~~
:::

## Accessibility — label

An icon is decorative by default and hidden from assistive tech (`aria-hidden`). When the icon *is* the
meaning — an icon-only button, a status glyph with no nearby text — pass `label`, and it becomes
`role="img"` with that `aria-label`. The third icon here has no label, so it stays decorative.

:::demo ex-icon-label

:::tabs
~~~html title="app.html"
<Icon name={{ 'trash-2' }} label={{ 'Delete' }} />
<Icon name={{ 'lock' }} label={{ 'Locked' }} />
<Icon name={{ 'search' }} />
~~~
:::
