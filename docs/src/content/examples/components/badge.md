# Badge — examples

Every feature of `<Badge>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Badge reference page](/ui/badge); this page is just the examples,
covering the full component surface.

```ts
import Badge from '@weave-framework/ui/badge';
```
```scss
@use 'pkg:@weave-framework/ui/badge';
```

## Variants

The `variant` prop picks the shape: `count` (default — an accent pill over the corner of the host),
`dot` (a bare 6px status dot, no text), and `tag` (a standalone outline label whose slot **is** the text).

:::demo ex-badge-variants

:::tabs
~~~html title="app.html"
<Badge content={{ 3 }}><Icon name={{ 'bell' }} label={{ 'Notifications' }} /></Badge>
<Badge variant={{ 'dot' }}><Icon name={{ 'mail' }} label={{ 'Messages' }} /></Badge>
<Badge variant={{ 'tag' }}>New</Badge>
~~~
:::

## Count content

`content` is the number/text a `count` pill shows. It's reactive — drive it from a signal and the pill
tracks it. An empty or missing `content` renders no pill at all.

:::demo ex-badge-count

:::tabs
~~~html title="app.html"
<Badge content={{ count() || '' }}><Icon name={{ 'bell' }} label={{ 'Notifications' }} /></Badge>
<button on:click={{ inc }}>Add one</button>
<button on:click={{ clear }}>Clear</button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(2);
  return {
    count,
    inc: () => count.set((n) => n + 1),
    clear: () => count.set(0),
  };
}
~~~
:::

## Capping the count

`max` caps the displayed count — anything over it shows as `max+`, so a busy count stays compact.

:::demo ex-badge-max

:::tabs
~~~html title="app.html"
<Badge content={{ 8 }}><Icon name={{ 'bell' }} label={{ 'Alerts' }} /></Badge>
<Badge content={{ 250 }} max={{ 99 }}><Icon name={{ 'mail' }} label={{ 'Inbox' }} /></Badge>
~~~
:::

## Position

`position` places the overlaid mark (`count` / `dot`) in any of the four corners. Default is `top-end`.

:::demo ex-badge-position

:::tabs
~~~html title="app.html"
<Badge content={{ 5 }} position={{ 'top-end' }}><Icon name={{ 'user' }} label={{ 'Top end' }} /></Badge>
<Badge content={{ 5 }} position={{ 'top-start' }}><Icon name={{ 'user' }} label={{ 'Top start' }} /></Badge>
<Badge content={{ 5 }} position={{ 'bottom-end' }}><Icon name={{ 'user' }} label={{ 'Bottom end' }} /></Badge>
<Badge variant={{ 'dot' }} position={{ 'bottom-start' }}><Icon name={{ 'user' }} label={{ 'Bottom start' }} /></Badge>
~~~
:::

## Accessible label

`label` overrides the host's accessible name. By default a `count` badge announces the bare number;
`label` lets a screen reader say something richer. The pill itself stays `aria-hidden`.

:::demo ex-badge-label

:::tabs
~~~html title="app.html"
<Badge content={{ 3 }} label={{ '3 unread notifications' }}>
  <Icon name={{ 'bell' }} />
</Badge>
<Badge variant={{ 'dot' }} label={{ 'Online' }}>
  <Icon name={{ 'user' }} />
</Badge>
~~~
:::

## Custom class

`class` is forwarded onto the Badge container, so layout and theming stay yours. The Weave classes stay;
yours are appended.

:::demo ex-badge-class

:::tabs
~~~html title="app.html"
<Badge variant={{ 'tag' }}>Default</Badge>
<Badge variant={{ 'tag' }} class={{ 'demo-tag-accent' }}>Styled</Badge>
~~~
:::
