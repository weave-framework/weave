# Paginator

Page through a long list — previous / next buttons around a windowed run of numbered pages with ellipses, a
"N–M of T" range, an optional page-size menu, and a jump-to-page box. It's controlled: you hold `pageIndex` /
`pageSize` and update them in `onPage`. The buttons, the page-size menu and the jump box are the real
[Button](/ui/button) / [Select](/ui/select) / [Input](/ui/input) components; the previous/next buttons render
lucide `chevron-left` / `chevron-right` [Icons](/ui/icon).

:::demo paginator-demo

## Import

```ts
import Paginator from '@weave-framework/ui/paginator';
```

```scss
@use 'pkg:@weave-framework/ui/paginator';
```

## Basic usage

Give it the total `length`, the current `pageSize` and `pageIndex`, and an `onPage` handler that receives the next
state on any change:

:::tabs
~~~html title="app.html"
<Paginator length={{ 240 }} pageSize={{ size() }} pageIndex={{ page() }} onPage={{ onPage }} pageSizeOptions={{ [10, 25, 50] }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

export function setup() {
  const page = signal(0);
  const size = signal(10);
  const onPage = (e) => { page.set(e.pageIndex); size.set(e.pageSize); };
  return { page, size, onPage };
}
~~~
:::

`pageIndex` is 0-based. `onPage` fires for page changes *and* size changes — read `e.pageIndex` / `e.pageSize` and
store both (the event also carries `length`). Changing the page size keeps the first visible item on screen, so the
emitted `pageIndex` may differ from the current one.

## Tuning what's shown

- `pageSizeOptions` — pass an array to show the page-size menu (omit it for no menu).
- `siblingCount` / `boundaryCount` — how many page numbers sit beside the current one / pinned at each end before an
  ellipsis (defaults 1 / 1).
- `showRange` / `showJump` — toggle the "N–M of T" label and the manual go-to-page input (both on by default);
  `jumpLabel` sets the text before that input (default "Go to"). Press **Enter** in it to navigate.

```html
<Paginator length={{ 500 }} pageSize={{ 25 }} pageIndex={{ page() }} onPage={{ onPage }}
           siblingCount={{ 2 }} showJump={{ false }} />
```

## Accessibility

It's a `<nav>` landmark (name it with `label`, default "Pagination"); the active page button carries
`aria-current="page"`, and the previous/next buttons are labelled Buttons ("Previous page" / "Next page") whose
chevron icons are `aria-hidden` decoration. Each numbered page button is labelled "Go to page N", and the ellipsis
is `aria-hidden`. The page-size menu and jump input are the real Select and Input, so their keyboard and ARIA come
along.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `length` | `number` | — | Total number of items. |
| `pageSize` | `number` | — | Items per page. |
| `pageIndex` | `number` | — | Current page (0-based). |
| `onPage` | `(event: PageEvent) => void` | — | Called with the next `{ pageIndex, pageSize, length }` on any change. |
| `pageSizeOptions` | `number[]` | — | If set, shows a page-size menu. |
| `siblingCount` | `number` | `1` | Pages on each side of the current one before an ellipsis. |
| `boundaryCount` | `number` | `1` | Pages pinned at each end. |
| `showRange` | `boolean` | `true` | Show the "N–M of T" range label. |
| `showJump` | `boolean` | `true` | Show the manual "go to page" input. |
| `disabled` | `boolean` | `false` | Disable the whole paginator. |
| `label` | `string` | `'Pagination'` | Accessible name for the nav landmark. |
| `jumpLabel` | `string` | `'Go to'` | Text of the label before the jump input. |
| `class` | `string` | — | Extra classes forwarded onto the `<nav>`. |
