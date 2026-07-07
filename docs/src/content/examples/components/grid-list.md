# Grid List — examples

Every feature of `<GridList>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Grid List reference page](/ui/grid-list); this page is just the examples,
covering the full component surface.

```ts
import GridList from '@weave-framework/ui/grid-list';
```
```scss
@use '@weave-framework/ui/grid-list';
```

## Basic — the container

`<GridList>` is pure layout: drop any tiles into the default slot and they auto-fill into evenly-sized
columns that reflow with the container width — no props, no JS.

:::demo ex-grid-list-basic

:::tabs
~~~html title="app.html"
<GridList>
  <div class="weave-grid-list__tile">One</div>
  <div class="weave-grid-list__tile">Two</div>
  <div class="weave-grid-list__tile">Three</div>
  <div class="weave-grid-list__tile">Four</div>
  <div class="weave-grid-list__tile">Five</div>
  <div class="weave-grid-list__tile">Six</div>
</GridList>
~~~
~~~ts title="app.ts"
import GridList from '@weave-framework/ui/grid-list';

export function setup() {
  return {};
}
~~~
:::

## Tiles — part classes

Compose cells from part classes: `weave-grid-list__tile` gives a square, hairline-separated cell, and
`weave-grid-list__tile--accent` fills one with the accent colour.

:::demo ex-grid-list-tiles

:::tabs
~~~html title="app.html"
<GridList>
  <div class="weave-grid-list__tile">Inbox</div>
  <div class="weave-grid-list__tile weave-grid-list__tile--accent">Starred</div>
  <div class="weave-grid-list__tile">Sent</div>
  <div class="weave-grid-list__tile">Drafts</div>
  <div class="weave-grid-list__tile">Archive</div>
  <div class="weave-grid-list__tile">Trash</div>
</GridList>
~~~
:::

## Class — a fixed column count

The `class` prop is merged onto the container alongside `weave-grid-list`, so your own utilities and
layout classes ride along — here, pinning the grid to three columns instead of auto-fill.

:::demo ex-grid-list-class

:::tabs
~~~html title="app.html"
<GridList class={{ 'demo-three-up' }}>
  <div class="weave-grid-list__tile">1</div>
  <div class="weave-grid-list__tile">2</div>
  <div class="weave-grid-list__tile">3</div>
  <div class="weave-grid-list__tile">4</div>
  <div class="weave-grid-list__tile">5</div>
  <div class="weave-grid-list__tile">6</div>
</GridList>
<style>
  .demo-three-up { grid-template-columns: repeat(3, 1fr); }
</style>
~~~
:::

## Colspan & rowspan

A tile keeps its own `grid-column` / `grid-row`, so any cell can span multiple columns or rows — the
gallery classic of a large featured tile beside smaller ones.

:::demo ex-grid-list-span

:::tabs
~~~html title="app.html"
<GridList class={{ 'demo-span-grid' }}>
  <div class="weave-grid-list__tile weave-grid-list__tile--accent" style="grid-column:span 2; grid-row:span 2;">Featured</div>
  <div class="weave-grid-list__tile">A</div>
  <div class="weave-grid-list__tile">B</div>
  <div class="weave-grid-list__tile" style="grid-column:span 2;">Wide</div>
  <div class="weave-grid-list__tile">C</div>
  <div class="weave-grid-list__tile">D</div>
</GridList>
<style>
  .demo-span-grid { grid-template-columns: repeat(4, 1fr); }
</style>
~~~
:::

## Customized — CSS custom properties

Retune the grid without touching SCSS: `--weave-grid-list-min-tile` sets the auto-fill tile size,
`--weave-grid-list-gap` the hairline width, and `--weave-grid-list-radius` the corner rounding.

:::demo ex-grid-list-customized

:::tabs
~~~html title="app.html"
<GridList class={{ 'demo-cozy-grid' }}>
  <div class="weave-grid-list__tile">A</div>
  <div class="weave-grid-list__tile">B</div>
  <div class="weave-grid-list__tile">C</div>
  <div class="weave-grid-list__tile weave-grid-list__tile--accent">D</div>
  <div class="weave-grid-list__tile">E</div>
  <div class="weave-grid-list__tile">F</div>
  <div class="weave-grid-list__tile">G</div>
  <div class="weave-grid-list__tile">H</div>
</GridList>
<style>
  .demo-cozy-grid {
    --weave-grid-list-min-tile: 64px;
    --weave-grid-list-gap: 4px;
    --weave-grid-list-radius: 12px;
  }
</style>
~~~
:::

## Data-driven — keyed `@for`

The tiles are just content, so render them from a signal with a keyed `@for`. Flag the featured cell by
switching its class.

:::demo ex-grid-list-items

:::tabs
~~~html title="app.html"
<GridList>
  @for (photo of photos(); track photo.id) {
    <div class={{ photo.featured ? 'weave-grid-list__tile weave-grid-list__tile--accent' : 'weave-grid-list__tile' }}>
      {{ photo.label }}
    </div>
  }
</GridList>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import GridList from '@weave-framework/ui/grid-list';

export function setup() {
  const photos = signal([
    { id: 1, label: 'Sunrise', featured: true },
    { id: 2, label: 'Harbour', featured: false },
    { id: 3, label: 'Ridge', featured: false },
    { id: 4, label: 'Meadow', featured: false },
    { id: 5, label: 'Dunes', featured: false },
    { id: 6, label: 'Falls', featured: false },
  ]);
  return { photos };
}
~~~
:::
