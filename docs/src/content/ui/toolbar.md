# Toolbar

A horizontal app bar — 52px tall, a surface background, a 1px bottom rule, no shadow. `<Toolbar>` is pure layout:
a flex row you compose from a few part classes and fill with whatever belongs up top — a menu button, a title, a
search field, some actions.

:::demo toolbar-basic

## Import

```ts
import Toolbar from '@weave-framework/ui/toolbar';
```

```scss
@use '@weave-framework/ui/toolbar';
```

## When to use it

As the bar across the top of an app, a page, or a panel. It's an unopinionated container — it won't decide what
goes inside, so drop in real Buttons, an [Icon](/ui/icon), a [ButtonToggle](/ui/button-toggle), whatever fits.

## Parts

Compose the row from these part classes:

| Class | Role |
| --- | --- |
| `weave-toolbar__start` | A group at the leading edge (menu, title). |
| `weave-toolbar__spacer` | Flexible gap — pushes what follows to the trailing edge. |
| `weave-toolbar__end` | A group at the trailing edge (actions). |

```html
<Toolbar>
  <div class="weave-toolbar__start">
    <Button variant={{ 'icon' }} label={{ 'Menu' }}><Icon name={{ 'menu' }} /></Button>
    <strong>Weave UI</strong>
  </div>
  <span class="weave-toolbar__spacer"></span>
  <div class="weave-toolbar__end">
    <Button variant={{ 'icon' }} label={{ 'Search' }}><Icon name={{ 'search' }} /></Button>
  </div>
</Toolbar>
```

## Variant & sticky

`variant="ink"` inverts the bar to the ink colour; `sticky` pins it to the top of its scroll container:

```html
<Toolbar variant={{ 'ink' }} sticky>
  <div class="weave-toolbar__start"><strong>Dashboard</strong></div>
</Toolbar>
```

## Accessibility

Toolbar stays an unopinionated container, so the semantic role is **yours to set** when the context calls for one —
`role="banner"` for a page's masthead, `role="toolbar"` for a cluster of controls. Add it on the `<Toolbar>`
yourself; the component won't guess.

```html
<Toolbar role="banner"> … </Toolbar>
```

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `'ink'` | — | Invert to an ink bar (default is surface). |
| `sticky` | `boolean` | `false` | Pin to the top (`position: sticky`). |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The bar's content — compose it from the part classes above. |
