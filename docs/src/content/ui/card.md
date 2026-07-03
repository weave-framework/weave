# Card

A surface to group related content — a keyline panel with a 1px border and a 4px radius, no shadow. `<Card>` is
pure layout: a vertical stack you fill with a handful of part classes. No behaviour, no opinions about what goes
inside — just a tidy container.

:::demo card-basic

## Import

```ts
import Card from '@weave-framework/ui/card';
```

```scss
@use '@weave-framework/ui/card';
```

## When to use it

Group things that belong together — a summary, a list item with actions, a media tile. If the whole card should be
clickable (navigate somewhere, open something), wrap its content in a link or button; `<Card>` stays a plain
surface so the semantics are yours to choose.

## Parts

A Card doesn't invent a prop per region — you compose it from **part classes**, so you keep full control of order
and content. Use whichever you need:

| Class | Role |
| --- | --- |
| `weave-card__media` | A full-bleed image/media at the top. |
| `weave-card__title` | The heading. |
| `weave-card__body` | The main text. |
| `weave-card__meta` | Secondary, quieter text (timestamps, counts). |
| `weave-card__actions` | A row for buttons at the bottom. |

```html
<Card>
  <img class="weave-card__media" src="/cover.jpg" alt="" />
  <h3 class="weave-card__title">Weekly digest</h3>
  <p class="weave-card__body">Your projects moved forward this week.</p>
  <p class="weave-card__meta">Updated 2 hours ago</p>
  <div class="weave-card__actions">
    <Button variant={{ 'marked' }}>Open</Button>
    <Button variant={{ 'ghost' }}>Dismiss</Button>
  </div>
</Card>
```

Every part is optional and order is yours — a Card with just a title and body is perfectly fine.

## Interactive cards

`interactive` adds a hover tint, the cue for a card that acts as a link or button. It's purely visual — to make the
card actually do something (and be reachable by keyboard), wrap the content in a real `<a>` or `<button>`:

:::demo card-interactive

```html
<a href="/settings">
  <Card interactive={{ true }}>
    <h3 class="weave-card__title">Open settings</h3>
    <p class="weave-card__body">Manage your account and preferences.</p>
  </Card>
</a>
```

:::callout warn "Interactive is a look, not a behaviour"
`interactive` only tints on hover — it does not make the card focusable or clickable. Always wrap it in a link or
button so keyboard and screen-reader users can reach it.
:::

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `interactive` | `boolean` | `false` | Add a hover tint (for cards that act as a link/button). |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The card's content — compose it from the part classes above. |
