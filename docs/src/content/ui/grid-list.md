# Grid List

A responsive grid of equal cells — image thumbnails, a gallery, a set of tiles. `<GridList>` is pure layout: a CSS
grid container you drop children into, and it wraps them into evenly-sized columns that reflow with the width.

:::demo grid-list-demo

## Import

```ts
import GridList from '@weave-framework/ui/grid-list';
```

```scss
@use 'pkg:@weave-framework/ui/grid-list';
```

## Usage

Put your tiles in the default slot and give each one the `weave-grid-list__tile` part class — that's what makes a
cell square, surfaced, and separated by the hairline gap. The container handles the columns:

```html
<GridList>
  <div class="weave-grid-list__tile">A</div>
  <div class="weave-grid-list__tile weave-grid-list__tile--accent">B</div>
  <div class="weave-grid-list__tile">C</div>
</GridList>
```

Columns auto-fill to the container width (`repeat(auto-fill, minmax(96px, 1fr))`), so the grid reflows with no JS.
Add `weave-grid-list__tile--accent` to fill a single tile with the accent colour. The tile's *content* is yours —
an image, a label, a link or button if it should be clickable.

## Customising

Everything comes from the grid-list token schema, so you can resize the cells or retint them globally:

```scss
@use 'pkg:@weave-framework/ui' as weave;

@include weave.grid-list-overrides((min-tile: 120px, gap: 2px));
```

The keys are `min-tile` (96px), `gap` (1px), `radius`, and the colours `border`, `tile-background`, `tile-text`,
`accent-background`, `accent-text` — each emitted as `--weave-grid-list-<key>`.

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
