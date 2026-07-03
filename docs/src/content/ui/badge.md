# Badge

A small mark that rides on the corner of something else — an unread count over a bell, a status dot on an avatar —
or stands alone as a little label. `<Badge>` comes in three flavours, and it keeps the count accessible without you
lifting a finger.

:::demo badge-variants

## Import

```ts
import Badge from '@weave-framework/ui/badge';
```

```scss
@use '@weave-framework/ui/badge';
```

## When to use it

Reach for a Badge to draw a quick eye to *state*: how many items are waiting, whether something is new or live. If
you need a full interactive chip (removable, selectable), that's [Chips](/ui/chips), not a Badge.

## Variants

The `variant` prop picks the shape.

| Variant | What it is | Content comes from |
| --- | --- | --- |
| `count` *(default)* | An accent pill over the corner of the thing you wrap. | `content` (the number/text). |
| `dot` | A bare 6px status dot over the corner — no text. | Nothing; it's just a dot. |
| `tag` | A standalone outline label. | The slot **is** the text. |

The `count` and `dot` variants **wrap a host** (the slotted icon/button) and float their mark over its corner. The
`tag` variant has no host — the slot content is the label itself:

```html
<!-- count + dot wrap a host -->
<Badge content={{ 3 }}><Icon name={{ 'bell' }} label={{ 'Notifications' }} /></Badge>
<Badge variant={{ 'dot' }}><Icon name={{ 'mail' }} label={{ 'Messages' }} /></Badge>

<!-- tag stands alone -->
<Badge variant={{ 'tag' }}>New</Badge>
```

## Capping the count

For a `count` badge, `max` caps what's shown — anything above it displays as `max+`, so a busy inbox doesn't blow
out your layout:

:::demo badge-max

```html
<Badge content={{ 8 }}><Icon name={{ 'bell' }} label={{ 'Alerts' }} /></Badge>
<Badge content={{ 250 }} max={{ 99 }}><Icon name={{ 'mail' }} label={{ 'Inbox' }} /></Badge>
```

A `count` badge shows only when there's something to show — an empty or missing `content` renders no pill (a `dot`
always shows; a `tag` is always its text).

## Position

`position` places the overlaid mark (`count` / `dot`) in any corner. Default is `top-end`:

```html
<Badge content={{ 5 }} position={{ 'bottom-start' }}>
  <Icon name={{ 'user' }} label={{ 'Profile' }} />
</Badge>
```

## Accessibility

You don't wire up the announcement — the Badge does it. For a `count`, the number is exposed as the host's
`aria-label` (so a screen reader says "Notifications, 3"), while the pill itself is `aria-hidden` (it's a visual
echo). Override the announced text with `label` when you want something richer than the bare number:

```html
<Badge content={{ 3 }} label={{ '3 unread notifications' }}>
  <Icon name={{ 'bell' }} />
</Badge>
```

A `tag` badge is just its own text, so it needs no extra labelling.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `'count' \| 'dot' \| 'tag'` | `'count'` | Which mark to render. |
| `content` | `string \| number` | — | The count/text for a `count` badge. |
| `max` | `number` | — | Cap the displayed count (over `max` shows `max+`). |
| `position` | `'top-end' \| 'top-start' \| 'bottom-end' \| 'bottom-start'` | `'top-end'` | Corner for the overlaid mark. |
| `label` | `string` | — | Accessible name for the host (defaults to the count). |
| `class` | `string` | — | Extra classes forwarded onto the container. |

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The host for `count`/`dot` (an icon, button…); the label text for `tag`. |
