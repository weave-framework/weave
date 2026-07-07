# Card — examples

Every feature of `<Card>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Card reference page](/ui/card); this page is just the examples,
covering the full component surface.

```ts
import Card from '@weave-framework/ui/card';
```
```scss
@use '@weave-framework/ui/card';
```

## Parts — the full stack

`<Card>` has no per-region props — you compose it from **part classes**: `weave-card__media`,
`weave-card__title`, `weave-card__body`, `weave-card__meta`, and `weave-card__actions`. Here they all
are, in order.

:::demo ex-card-parts

:::tabs
~~~html title="app.html"
<Card>
  <img class="weave-card__media" src="/cover.jpg" alt="Cover" />
  <h3 class="weave-card__title">Weekly digest</h3>
  <p class="weave-card__body">Your projects moved forward: 12 commits, 3 reviews, and one release went out.</p>
  <p class="weave-card__meta">Updated 2 hours ago</p>
  <div class="weave-card__actions">
    <Button variant={{ 'marked' }}>Open</Button>
    <Button variant={{ 'ghost' }}>Dismiss</Button>
  </div>
</Card>
~~~
~~~ts title="app.ts"
import Card from '@weave-framework/ui/card';
import Button from '@weave-framework/ui/button';

export function setup() {
  return {};
}
~~~
:::

## Minimal — title + body

Every part is optional and the order is yours. A Card with just a title and body is perfectly fine.

:::demo ex-card-minimal

:::tabs
~~~html title="app.html"
<Card>
  <h3 class="weave-card__title">Just the essentials</h3>
  <p class="weave-card__body">A Card with only a title and body is perfectly fine.</p>
</Card>
~~~
:::

## Media

The `weave-card__media` part holds a full-bleed image or media at the top — it bleeds to the card edges
and the corners are clipped to the radius for you.

:::demo ex-card-media

:::tabs
~~~html title="app.html"
<Card>
  <img class="weave-card__media" src="/landscape.jpg" alt="Landscape" />
  <h3 class="weave-card__title">Media tile</h3>
  <p class="weave-card__body">The media element bleeds to the card edges.</p>
</Card>
~~~
:::

## Interactive

`interactive` adds a hover tint — the cue for a card that acts as a link or button. It's purely visual,
so wrap the content in a real `<a>` or `<button>` to make it focusable and clickable.

:::demo ex-card-interactive

:::tabs
~~~html title="app.html"
<a href="/settings">
  <Card interactive={{ true }}>
    <h3 class="weave-card__title">Open settings</h3>
    <p class="weave-card__body">The whole card tints on hover.</p>
  </Card>
</a>
~~~
:::

## Custom class

`class` is forwarded onto the container next to `weave-card`, so your own layout and utility classes
ride along — here a max-width utility.

:::demo ex-card-class

:::tabs
~~~html title="app.html"
<Card class={{ 'demo-narrow-card' }}>
  <h3 class="weave-card__title">Custom class</h3>
  <p class="weave-card__body">The `class` prop is merged onto the container alongside `weave-card`.</p>
</Card>
~~~
:::
