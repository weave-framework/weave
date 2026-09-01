# Progress Spinner

A spinning ring for work of unknown length — a ring with an accent arc that rotates. Reach for it when there's no
percentage to show (a request in flight, a page loading) and you just need to say "working…".

:::demo progress-spinner-demo

## Import

```ts
import ProgressSpinner from '@weave-framework/ui/progress-spinner';
```

```scss
@use 'pkg:@weave-framework/ui/progress-spinner';
```

## Usage

Drop it in — it's always indeterminate. Two sizes: the default 26px ring, or `small={{ true }}` for a compact 18px
one (good inside a button or next to text):

```html
<ProgressSpinner label={{ 'Loading' }} />
<ProgressSpinner small={{ true }} label={{ 'Saving' }} />
```

It's a `role="progressbar"` with no `aria-valuenow` (the work has no measurable length). Give it a `label` so screen
readers announce what's loading.

## Progress Bar or Spinner?

- **[Progress Bar](/ui/progress-bar)** when you have a percentage, or want a determinate/indeterminate line.
- **Spinner** when you have neither a percentage nor the room for a bar — an inline "busy" mark.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `small` | `boolean` | `false` | The compact 18px ring instead of the default 26px. |
| `label` | `string` | — | Accessible name for the spinner. |
| `class` | `string` | — | Extra classes forwarded onto the ring. |

## When it goes wrong

:::callout trap "Correct markup, no styling"
Two lines, two files. The component import gives you the markup; the Sass import gives you the look, and
missing the second is the most common first problem with any Weave UI component:

~~~scss
@use 'pkg:@weave-framework/ui/progress-spinner';
~~~

Styles are opt-in per component so an app ships only the CSS it uses — which is a real saving and a
predictable first surprise.
:::

**Colours and spacing that are *almost* right.** The theme is emitted from a **global** stylesheet, once.
Emit it inside a component's `.scss` and the tokens are scoped there, so everything else silently falls
back to defaults. See [Installation](/ui/installation).

**A style of yours that will not apply to it.** This component's root carries **its own** scope
attribute, not your component's, so a plain scoped selector cannot reach inside it. Reach through a
container you own with `:global()` — see [Styling](/learn/styling#the-one-gotcha-worth-knowing).
