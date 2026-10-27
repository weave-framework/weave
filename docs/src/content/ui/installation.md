# Installation

The UI library is a separate package. A scaffolded Weave app does **not** include it, and getting the
first `<Button>` on screen is two steps: install the package, and add its stylesheet to your config.
There is no Sass to install and no style language to switch.

Do both. Skipping the stylesheet is the one failure that says nothing: the component renders, the build
succeeds, and you get an unstyled native control.

## 1. Install the package

```bash
npm install @weave-framework/ui
```

## 2. Add its stylesheet as a global entry

The package ships `weave-ui.css` — the default theme (every design token, on `:root`) plus the CSS of every
built-in component, prebuilt. Register it as a **global** entry in `weave.config.ts`, named the way an
import names it:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  styles: ['@weave-framework/ui/weave-ui.css'], // ← global: compiled first, unscoped
  // …
});
~~~

Your own component stylesheets stay whatever they are — plain `.css` is fine, `styleLang` does not change.

:::callout warn "It must be a `styles` entry, not a component stylesheet"
Component styles are **scoped**: every selector is rewritten to match only the elements that component
renders. A theme pulled into a component's stylesheet puts its `:root { --weave-… }` under a
`[data-w-xxxxxx]:root` selector that can never match — so no token is ever defined, and every component
renders unstyled while ~120 KB of CSS ships. The compiler warns when it scopes a `:root`/`html`/`body`
rule, and the fix is always the same: a global entry listed in `styles`.
See [Styling → app-wide styles](/learn/styling#app-wide-styles).
:::

## 3. Import components and use them

Each component is a default export on its own subpath:

~~~ts title="src/app/app.ts"
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

export function setup() {
  const save = (): void => {
    /* … */
  };
}
~~~

~~~html title="src/app/app.html"
<Button variant="primary" on:click={{ save }}>Save</Button>
~~~

That's it — the button is themed, keyboard-accessible, and reads the tokens you can now retune from one
place.

## Retheming from plain CSS

Every value the library paints with is a CSS custom property, so a global stylesheet of your own —
listed in `styles` *after* the library's — changes the whole library, or one component, or one subtree:

~~~css title="src/styles/theme.css"
:root {
  --weave-color-accent: #b25dff; /* every component's accent */
  --weave-shape-radius: 4px;
}
.sidebar {
  --weave-button-background: transparent; /* only buttons inside the sidebar */
}
~~~

~~~ts title="weave.config.ts"
styles: ['@weave-framework/ui/weave-ui.css', 'src/styles/theme.css'],
~~~

[Styling & theming](/ui/theming) lists every token.

## The Sass route: a custom theme, or less CSS

`weave-ui.css` is the default output of the library's Sass engine. Use the engine directly when you want
`theme()` with overrides computed at build time, or to ship only the components you use (`weave-ui.css`
carries all of them, ~120 KB). Three things change:

1. **Install `sass`** alongside the library: `npm install @weave-framework/ui sass`.
2. **Switch the project to Sass** — `styleLang: 'scss'` in `weave.config.ts`, and rename your component
   stylesheets to match (`src/app/app.css` → `src/app/app.scss`; plain CSS is valid Sass).
3. **Author the global entry yourself**, and list it in `styles` instead of `weave-ui.css`:

~~~scss title="src/styles/main.scss"
@use 'pkg:@weave-framework/ui' as weave;

@include weave.theme(( color: ( accent: #2f9e8f ) )); // the design tokens, on :root — with overrides
@include weave.all-styles(); // the component CSS that reads them
~~~

~~~ts title="weave.config.ts"
styleLang: 'scss',
styles: ['src/styles/main.scss'],
~~~

`sass` is what compiles the library's stylesheets. (The Weave CLI already carries it as an optional
dependency, so it may be present — installing it explicitly makes the requirement your project's own.)

### Shipping less CSS

`all-styles()` emits the CSS for **every** built-in component. Once you know what you use, pull the
components' Sass entries individually instead:

~~~scss title="src/styles/main.scss"
@use 'pkg:@weave-framework/ui' as weave;
@use 'pkg:@weave-framework/ui/button';
@use 'pkg:@weave-framework/ui/input';
@use 'pkg:@weave-framework/ui/dialog';

@include weave.theme();
@include weave.reduced-motion(); // `all-styles()` includes this; per-component setups add it themselves
~~~

## When it goes wrong

Almost every problem with a Weave UI component is one of five, and none of them throws. Check these
before anything else — between them they account for nearly every "the component does not work".

:::callout trap "It renders, and it looks like nothing"
The stylesheet is not loaded. With the prebuilt file that means the `styles` line is missing from
`weave.config.ts`, or sits in a component stylesheet instead of a global entry. On the per-component
Sass route it means the component's own entry was not pulled in — every component needs **two** lines
there, and they live in different files:

~~~ts title="the component, in your .ts"
import Button from '@weave-framework/ui/button';
~~~
~~~scss title="its styles, in your .scss"
@use 'pkg:@weave-framework/ui/button';
~~~

Miss the second and you get correct, accessible, completely unstyled markup. That is deliberate on that
route: styles are opt-in per component so an app ships only the CSS it uses.
:::

**The theme is missing, so everything is slightly wrong.** The theme — `weave-ui.css`, or
`@use 'pkg:@weave-framework/ui' as weave;` plus the theme emit — belongs in a **global** stylesheet,
once. Put it in a component's `.scss` and the tokens are scoped to that component — every other
component then falls back, and the symptom is colours and spacing that are *almost* right rather than
obviously broken.

**A `<Select>` or `<Autocomplete>` that renders `undefined` in every row.** Its options are objects the
defaults cannot read. Since 3.0.0 the type asks for the two accessors, so this is a compile error rather
than a silent page — but if you are upgrading from 2.x, that is what those errors mean:

~~~html
<Select options={{ users() }} optionValue={{ (u) => u.id }} optionLabel={{ (u) => u.name }} />
~~~

**A form control that shows but does not bind.** Every input-like component takes a `control`; without
one it is an uncontrolled element that looks fine and reports nothing to your form. See
[Forms](/learn/forms).

**A dialog, snackbar, menu or tooltip that never appears.** Those four are **imperative** — you call
`openDialog(…)`, you do not place a tag. Putting `<Dialog>` in a template renders nothing, because there
is no such component to render.

:::callout info "Two things that are not your bug"
An overlay positioned oddly on a page with `overflow: hidden` on an ancestor: overlays escape to the body
by design, and a clipping ancestor is a layout question, not a component one.

And a component that ignores an animation: the built-ins respect `prefers-reduced-motion`, so a machine
with that setting on will show you the reduced version of everything.
:::

## Where to next

- Every token and knob — [Styling & theming](/ui/theming)
- The components themselves → start with [Button](/ui/button)
- How scoping works in your own styles — [Styling](/learn/styling)
