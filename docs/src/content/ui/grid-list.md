# Grid List

A responsive grid of equal cells — image thumbnails, a gallery, a set of tiles. `<GridList>` is pure layout: a CSS
grid container you drop children into, and it wraps them into evenly-sized columns that reflow with the width.

:::demo grid-list-demo

## Import

```ts
import GridList from '@weave-framework/ui/grid-list';
```

```scss
@use '@weave-framework/ui/grid-list';
```

## Usage

Put whatever tiles you like in the default slot — cards, images, links. The grid handles the columns and gaps:

```html
<GridList>
  <img src="/a.jpg" alt="" />
  <img src="/b.jpg" alt="" />
  <img src="/c.jpg" alt="" />
</GridList>
```

It's an unopinionated container, so the tiles' content, aspect ratio, and interactivity are yours — wrap a tile in a
link or button if it should be clickable.

## Accessibility

`<GridList>` is a layout wrapper with no widget semantics of its own — the meaning lives in what you put inside
(images with `alt`, links, buttons). If the grid represents a single-select set, reach for a selectable
[List](/ui/list) or the data [Table](/ui/table) instead, which carry the right roles.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The grid's tiles. |
