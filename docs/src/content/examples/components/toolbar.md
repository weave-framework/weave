# Toolbar — examples

Every feature of `<Toolbar>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Toolbar reference page](/ui/toolbar); this page is just the examples,
covering the full component surface.

```ts
import Toolbar from '@weave-framework/ui/toolbar';
```
```scss
@use 'pkg:@weave-framework/ui/toolbar';
```

## Part classes — start, spacer, end

`<Toolbar>` is pure layout: the default slot holds whatever you compose from the part classes —
`weave-toolbar__start` (leading group), `weave-toolbar__spacer` (flexible gap), and
`weave-toolbar__end` (trailing group). Drop real Buttons and Icons in for a working app bar.

:::demo ex-toolbar-parts

:::tabs
~~~html title="app.html"
<Toolbar>
  <div class="weave-toolbar__start">
    <Button variant={{ 'icon' }} label={{ 'Menu' }}><Icon name={{ 'menu' }} /></Button>
    <strong>Weave UI</strong>
  </div>
  <span class="weave-toolbar__spacer"></span>
  <div class="weave-toolbar__end">
    <Button variant={{ 'icon' }} label={{ 'Search' }}><Icon name={{ 'search' }} /></Button>
    <Button variant={{ 'icon' }} label={{ 'Settings' }}><Icon name={{ 'settings' }} /></Button>
  </div>
</Toolbar>
~~~
~~~ts title="app.ts"
import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

export function setup() {
  return {};
}
~~~
:::

## Variant — ink

`variant="ink"` inverts the surface bar to the ink colour — a dark app bar for dashboards and headers.

:::demo ex-toolbar-ink

:::tabs
~~~html title="app.html"
<Toolbar variant={{ 'ink' }}>
  <div class="weave-toolbar__start">
    <Button variant={{ 'icon' }} label={{ 'Menu' }}><Icon name={{ 'menu' }} /></Button>
    <strong>Dashboard</strong>
  </div>
  <span class="weave-toolbar__spacer"></span>
  <div class="weave-toolbar__end">
    <Button variant={{ 'ghost' }}>Sign out</Button>
  </div>
</Toolbar>
~~~
:::

## Sticky

`sticky` pins the bar to the top of its scroll container (`position: sticky`). Scroll the panel — the
bar holds while the content moves under it.

:::demo ex-toolbar-sticky

:::tabs
~~~html title="app.html"
<div style="height:180px; overflow:auto;">
  <Toolbar sticky>
    <div class="weave-toolbar__start"><strong>Sticky header</strong></div>
    <span class="weave-toolbar__spacer"></span>
    <div class="weave-toolbar__end">
      <Button variant={{ 'icon' }} label={{ 'More' }}><Icon name={{ 'more-vertical' }} /></Button>
    </div>
  </Toolbar>
  <!-- … scrolling content … -->
</div>
~~~
:::

## Custom class

`class` is forwarded straight onto the container, so layout tweaks — rounding, borders, spacing —
stay the consumer's job.

:::demo ex-toolbar-class

:::tabs
~~~html title="app.html"
<Toolbar class={{ 'demo-rounded' }}>
  <div class="weave-toolbar__start"><strong>Rounded bar</strong></div>
  <span class="weave-toolbar__spacer"></span>
  <div class="weave-toolbar__end">
    <Button variant={{ 'icon' }} label={{ 'Add' }}><Icon name={{ 'plus' }} /></Button>
  </div>
</Toolbar>
~~~
:::

## Accessibility — role

Toolbar sets no semantic role itself — it stays an unopinionated layout container. Add `role="banner"`
for a page masthead, or `role="toolbar"` for a cluster of controls, yourself on the `<Toolbar>`.

:::demo ex-toolbar-role

:::tabs
~~~html title="app.html"
<Toolbar role="banner">
  <div class="weave-toolbar__start">
    <Button variant={{ 'icon' }} label={{ 'Menu' }}><Icon name={{ 'menu' }} /></Button>
    <strong>Acme</strong>
  </div>
  <span class="weave-toolbar__spacer"></span>
  <div class="weave-toolbar__end">
    <Button variant={{ 'outline' }}>Log in</Button>
  </div>
</Toolbar>
~~~
:::
