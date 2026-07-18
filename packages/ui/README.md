# @weave-framework/ui

Weave UI — a signal-native component library with the Weave design system, plus a headless behavior layer (CDK). Ships SCSS; zero third-party runtime deps.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/ui
```

## Quick start

Two steps: pull in the styles once, then import components per subpath.

**1. Styles** — the whole library is painted from CSS custom properties emitted by one Sass engine:

```scss
@use 'pkg:@weave-framework/ui' as weave;

@include weave.theme();      // the token values — :root custom properties
@include weave.all-styles(); // the component CSS that consumes them
```

**2. Components** — each is a default export on its own subpath:

```ts
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';
```

```html
<Button on:click={{ save }}>Save</Button>
<Button variant={{ 'outline' }}>Cancel</Button>
<Button variant={{ 'icon' }} label={{ 'Delete' }}><Icon name={{ 'trash-2' }} /></Button>
```

Components are native-first: `<Button>` renders one real `<button>`, so keyboard, focus, and form submission come for free — no wrappers, no re-implemented semantics.

## Components

Each has a JS entry at `@weave-framework/ui/<name>` and its own Sass entry at the same subpath.

| | | |
|---|---|---|
| **Buttons & indicators** | `button` · `button-toggle` · `badge` · `icon` · `ripple` | `progress-bar` · `progress-spinner` |
| **Form controls** | `input` · `form-field` · `checkbox` · `radio` · `slide-toggle` | `select` · `autocomplete` · `chips` · `slider` |
| **Date & time** | `datepicker` · `date-range-picker` · `timepicker` | |
| **Layout & surfaces** | `card` · `toolbar` · `sidenav` · `expansion` · `grid-list` | `list` · `tabs` · `stepper` |
| **Popups & overlays** | `dialog` · `bottom-sheet` · `snackbar` · `tooltip` | `menu` · `menubar` · `context-menu` · `popover-edit` |
| **Data** | `table` · `tree` · `paginator` | |

`@weave-framework/ui/divider` and `@weave-framework/ui/overlay` are style-only entries (Sass, no JS).

Every icon in the library is a real inline SVG rendered by `<Icon>` from the icon registry — the built-in Lucide set by default — never a CSS-drawn shape or a Unicode glyph. Pass `name` to look one up, or `svg` / `src` to render your own.

## Theming

Tokens are plain CSS custom properties in two tiers — global (`--weave-color-accent`, `--weave-shape-radius`) and per-component (`--weave-button-background`). You re-skin by changing token values, never by overriding component selectors.

```scss
@include weave.theme((
  color: (accent: #2f9e8f, ink: #101216),
  shape: (radius: 8px),
));
```

Because they're real custom properties, you can also override them anywhere in plain CSS — no Sass needed:

```css
.dark-corner { --weave-color-accent: #b25dff; } /* recolours every Weave component inside */
```

Prefer leaner CSS? Skip `all-styles()` and pull only what you use: `@use 'pkg:@weave-framework/ui/button';`

## The CDK

`@weave-framework/ui/cdk` is the headless layer the styled components are built on — behavior and state, zero styling. Use it directly when you're building your own components:

overlays and portals · connected positioning · scroll strategies · focus trap and focus monitor · live announcer · typeahead/list key managers · resize and intersection observers as signals · breakpoint observer · clipboard · selection model · data sources · virtual scroll · drag & drop · date adapters.

Everything is in-house and zero-dep, RTL-aware, and honours `prefers-reduced-motion`.

📚 **Guides + per-component API:** [Component docs](https://weaveframework.dev/ui/button) · [Styling & theming](https://weaveframework.dev/ui/theming) · [Live examples](https://weaveframework.dev/examples)

## License

MIT
