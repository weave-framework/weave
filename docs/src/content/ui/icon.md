# Icon

A single glyph, woven inline. `<Icon>` renders an SVG — from the built-in [Lucide](https://lucide.dev) set by
name, or from your own markup — at a tidy 18px with a 1.4 hairline stroke. It draws in `currentColor`, so an icon
quietly takes on the text colour around it. Lean DOM: one `<span>`, the SVG inside.

:::demo icon-basic

## Import

```ts
import Icon from '@weave-framework/ui/icon';
```

```scss
@use '@weave-framework/ui/icon';
```

## When to use it

Anywhere you'd reach for a small pictogram — inside a button, next to a label, as a status mark. For anything
meaningful (an icon that carries information on its own), give it a `label`; for pure decoration, leave it off and
it's hidden from screen readers automatically (more in [Accessibility](#accessibility)).

## Basic usage

Name any icon from the built-in set and it renders instantly:

```html
<Icon name={{ 'search' }} />
<Icon name={{ 'bell' }} />
<Icon name={{ 'settings' }} />
```

There's no import per icon and no async wait — the built-in Lucide set is bundled and resolves synchronously.

## Colour

An icon is drawn in `currentColor`, so it inherits the text colour of whatever contains it — set the colour on a
parent and the icon follows:

:::demo icon-color

```html
<span style="color:#2d7a4e"><Icon name={{ 'circle-check' }} /></span>
<span style="color:#c0392b"><Icon name={{ 'circle-alert' }} /></span>
```

That's why an `<Icon>` inside a `<Button>` automatically matches the button's text — no per-icon colour needed.

## Where the SVG comes from

Three sources, checked in this order. Pick whichever fits:

| Prop | Use it for | Example |
| --- | --- | --- |
| `name` | An icon from the active registry (built-in Lucide by default). | `<Icon name={{ 'star' }} />` |
| `svg` | A complete `<svg>…</svg>` string you supply inline. | `<Icon svg={{ mySvg }} />` |
| `src` | A URL to a standalone `.svg` file (fetched, then rendered). | `<Icon src={{ '/logo.svg' }} />` |

```html
<!-- your own inline SVG, bypassing the registry -->
<Icon svg={{ '<svg viewBox="0 0 24 24">…</svg>' }} />

<!-- a remote file -->
<Icon src={{ '/icons/brand.svg' }} />
```

:::callout tip "Untrusted SVG is sanitised"
Both `svg` and `src` are cleaned before they hit the DOM (zero-dep, native `DOMParser`): `<script>`,
`<foreignObject>`, every `on*` handler, and `javascript:` URLs are stripped — so a remote `<svg onload=…>` can't run.
:::

## Accessibility

An icon is decorative by default and hidden from assistive tech (`aria-hidden`). When the icon *is* the meaning —
an icon-only button, a status glyph with no nearby text — pass a `label`, and it becomes `role="img"` with that
`aria-label`:

```html
<!-- decorative: sits next to a visible "Search" label -->
<Icon name={{ 'search' }} />

<!-- meaningful: the icon carries the meaning on its own -->
<Icon name={{ 'trash-2' }} label={{ 'Delete' }} />
```

## Extending the registry

Need brand icons or a different set? Register more sources once, at app start — every `<Icon>` sees them. A custom
source is a `name → svg` function; the built-in set stays as the fallback unless you turn it off.

```ts
import { configureIcons } from '@weave-framework/ui/icon';

configureIcons({
  sources: [(name) => brandIcons[name]], // consulted first
  builtin: true, // keep Lucide as the fallback (default)
});
```

Changing `name` (or a source's async cache filling in) re-renders the icon in place — no reload.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | — | Look up this name in the active registry. |
| `svg` | `string` | — | A complete `<svg>…</svg>` to render directly (sanitised). |
| `src` | `string` | — | URL of an `.svg` file to fetch and render (sanitised). |
| `label` | `string` | — | Accessible name → `role="img"` + `aria-label`. Omit for decorative (`aria-hidden`). |

### Slots

`<Icon>` takes no slotted content — the glyph comes from `name` / `svg` / `src`.
