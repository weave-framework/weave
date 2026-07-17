# Styling & theming

Every Weave UI component is painted entirely from **CSS custom properties** — design tokens — and those tokens come
from one Sass engine. You emit the theme once, and from then on you re-skin the whole library (or one component, or
one subtree) by changing token values, never by overriding component selectors. This page is the whole styling
system: how to load it, how tokens are named, and every knob you can turn.

## The one-time setup

Pull the library's Sass in through its package entry (the `pkg:` importer resolves it), then emit two things: the
**theme** (all the token values) and the **structural styles** (the component CSS that reads them).

```scss
@use 'pkg:@weave-framework/ui' as weave;

@include weave.theme();      // the token values — :root custom properties
@include weave.all-styles(); // the component CSS that consumes them
```

That's the entire baseline. `theme()` writes the `--weave-*` custom properties; `all-styles()` writes the rules for
every built-in component. Import a component's JS from its subpath (`@weave-framework/ui/button`) and its styles are
already present.

:::callout tip "Per-component styles, if you prefer"
Instead of `all-styles()`, you can pull just the components you use — each has its own Sass entry:
`@use '@weave-framework/ui/button';`. The umbrella `all-styles()` is simplest; per-component keeps the CSS lean.
:::

## How tokens are named

There are two tiers, both plain CSS custom properties:

| Tier | Shape | Example |
| --- | --- | --- |
| **Global** | `--weave-<group>-<key>` | `--weave-color-accent`, `--weave-shape-radius` |
| **Component** | `--weave-<name>-<key>` | `--weave-button-background`, `--weave-input-border` |

The global groups are **`color`**, **`text`** (typography), **`shape`** (radii, borders), and **`motion`**
(durations). Component tokens mostly *reference* the globals (so changing one accent recolours everything), with a
few literals of their own. Because they're real custom properties, you can read or override them from anywhere —
even plain CSS, no Sass required:

```css
.dark-corner { --weave-color-accent: #b25dff; } /* recolours every Weave component inside */
```

## Theming — change the defaults

`theme()` takes a **partial** overrides map, deep-merged over the Weave defaults — pass only what you change:

```scss
@include weave.theme((
  color: (
    accent: #2f9e8f,
    ink: #101216,
  ),
  shape: (radius: 8px),
));
```

One call re-emits every global and component var with your palette folded in. Nothing else moves.

### Partial recompiles

If you only touch one concern, the matching partial mixin emits just that slice (smaller output than a full
`theme()`):

```scss
@include weave.colors((color: (accent: #e5484d)));   // only colour vars
@include weave.sizes((shape: (radius: 2px)));         // only shape / size vars
@include weave.typography((text: (font: 'Inter')));   // only typography vars
```

## Per-component overrides

To retune a single component, use its named override mixin — discoverable, one per built-in. At the root it's
global; inside a selector it's **scoped** to that subtree:

```scss
// globally: thicker dividers everywhere
@include weave.divider-overrides((thickness: 2px, margin-top: 8px));

// scoped: compact buttons only inside .toolbar
.toolbar { @include weave.button-overrides((padding-y: 4px)); }
```

The generic form is `weave.overrides('<name>', (...))` if you'd rather pass the name as a string.

## Dark mode

`theme()` honours the current selector, so a dark palette is just a themed block under your dark scope:

```scss
:root        { @include weave.theme(); }                       // light default
[data-theme='dark'] {
  @include weave.colors((color: (
    surface: #16171b, ink: #f4f5f7, line: #2a2c31,
  )));
}
```

Toggle `data-theme` on `<html>` and every component re-skins instantly — no per-component dark rules.

## Reference a token in your own CSS

`ref('group.key')` resolves to the right `var(--weave-…)` so your own styles stay in lockstep with the theme:

```scss
.price-tag {
  color: weave.ref('color.accent');
  border-radius: weave.ref('shape.radius');
}
```

## Shared helpers

The same building blocks the components use are yours too:

```scss
.my-control:focus-visible { @include weave.focus-ring; }          // the accent focus ring
.my-control:focus-visible { @include weave.focus-ring(#e5484d, 3px, 2px); } // colour, width, offset
```

## Register your own component

`define()` puts a component of your own into the same token system — give it a grouped schema (values can `ref()`
the globals or be literals) and it emits `--weave-<name>-*` vars just like a built-in, overridable the same way:

```scss
@include weave.define('rating', (
  color: (star: weave.ref('color.accent')),
  size:  (gap: 4px),
));

.rating__star { color: var(--weave-rating-star); gap: var(--weave-rating-gap); }
```

Now `weave.overrides('rating', (...))` retunes it, and it re-skins with every theme change — your component is a
first-class citizen of the same engine.

## The whole API at a glance

| Mixin / function | What it does |
| --- | --- |
| `theme($overrides?)` | Emit all global + component tokens (defaults deep-merged with your map). |
| `all-styles()` | Emit the structural CSS for every built-in component. |
| `colors()` / `sizes()` / `typography()` | Partial recompile of just that concern. |
| `<name>-overrides($map)` | Retune one component (global at root, scoped in a selector). |
| `overrides($name, $map)` | The same, with the name as a string. |
| `define($name, $grouped)` | Register your own component's tokens. |
| `ref('group.key')` | Resolve a theme token to its `var(--weave-…)`. |
| `focus-ring($color?, $width?, $offset?)` | The shared accent focus ring. |
