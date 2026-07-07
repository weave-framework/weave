# Paginator — examples

Every feature of `<Paginator>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Paginator reference page](/ui/paginator); this page is just the examples,
covering the full component surface.

```ts
import Paginator from '@weave-framework/ui/paginator';
```
```scss
@use '@weave-framework/ui/paginator';
```

## Basic — length + pageSize + pageIndex + onPage

Controlled navigation over a total item count. Hold `pageIndex` (0-based) and `pageSize` in signals and
update them from `onPage` — the paginator computes the page count and the range label itself.

:::demo ex-paginator-basic

:::tabs
~~~html title="app.html"
<Paginator length={{ 240 }} pageSize={{ size() }} pageIndex={{ page() }} onPage={{ onPage }} />
<span>Showing {{ from() }}–{{ to() }} of 240 · page {{ page() + 1 }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

export function setup() {
  const page = signal(0);
  const size = signal(10);
  const onPage = (e) => { page.set(e.pageIndex); size.set(e.pageSize); };
  const from = () => page() * size() + 1;
  const to = () => Math.min(240, (page() + 1) * size());
  return { page, size, onPage, from, to };
}
~~~
:::

## Page-size menu — pageSizeOptions

Pass `pageSizeOptions` to add the page-size `<Select>`. `onPage` fires for size changes too — read
`e.pageSize` and store it. Changing the size keeps the first visible item on screen (the new `pageIndex`
comes back on the event).

:::demo ex-paginator-page-size

:::tabs
~~~html title="app.html"
<Paginator length={{ 973 }} pageSize={{ size() }} pageIndex={{ page() }} onPage={{ onPage }} pageSizeOptions={{ sizes }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

export function setup() {
  const page = signal(0);
  const size = signal(12);
  const onPage = (e) => { page.set(e.pageIndex); size.set(e.pageSize); };
  return { page, size, sizes: [12, 24, 48], onPage };
}
~~~
:::

## Windowing — siblingCount + boundaryCount

`siblingCount` sets how many page numbers sit on each side of the current one; `boundaryCount` pins that
many at each end. Gaps collapse to an ellipsis (`…`). Here we also drop the range label and jump input with
`showRange={{ false }}` / `showJump={{ false }}` for a numbers-only pager.

:::demo ex-paginator-window

:::tabs
~~~html title="app.html"
<Paginator length={{ 1000 }} pageSize={{ 20 }} pageIndex={{ page() }} onPage={{ onPage }}
           siblingCount={{ 2 }} boundaryCount={{ 2 }} showJump={{ false }} showRange={{ false }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

export function setup() {
  const page = signal(24);
  const onPage = (e) => page.set(e.pageIndex);
  return { page, onPage };
}
~~~
:::

## Jump input — showJump + jumpLabel

The manual go-to-page `<Input>` is on by default (`showJump`); `jumpLabel` renames its label. Type a page
number and press Enter — out-of-range values are clamped.

:::demo ex-paginator-jump

:::tabs
~~~html title="app.html"
<Paginator length={{ 500 }} pageSize={{ 25 }} pageIndex={{ page() }} onPage={{ onPage }} jumpLabel={{ 'Jump to' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

export function setup() {
  const page = signal(0);
  const onPage = (e) => page.set(e.pageIndex);
  return { page, onPage };
}
~~~
:::

## Disabled

`disabled` freezes the whole paginator — prev/next, every page button, the jump input and the size menu all
ignore input.

:::demo ex-paginator-disabled

:::tabs
~~~html title="app.html"
<Paginator length={{ 240 }} pageSize={{ 10 }} pageIndex={{ page() }} onPage={{ onPage }}
           pageSizeOptions={{ [10, 25, 50] }} disabled={{ true }} />
~~~
:::

## Accessible name + custom class — label + class

`label` names the `<nav>` landmark for assistive tech (default `"Pagination"`); `class` forwards extra
classes onto the same `<nav>` for styling hooks.

:::demo ex-paginator-label-class

:::tabs
~~~html title="app.html"
<Paginator length={{ 120 }} pageSize={{ 20 }} pageIndex={{ page() }} onPage={{ onPage }}
           label={{ 'Search results pages' }} class={{ 'my-pager' }} />
~~~
:::
