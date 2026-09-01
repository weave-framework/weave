# Installation

The UI library is a separate package. A scaffolded Weave app does **not** include it, so getting the
first `<Button>` on screen takes four steps rather than one — three of them about styles, because the
components are painted entirely from Sass-emitted design tokens.

Do all four. Skipping the style setup is the one failure that says nothing: the component renders, the
build succeeds, and you get an unstyled native control.

## 1. Install the package

```bash
npm install @weave-framework/ui sass
```

`sass` is what compiles the library's stylesheets. (The Weave CLI already carries it as an optional
dependency, so it may be present — installing it explicitly makes the requirement your project's own.)

## 2. Switch the project to Sass

The library's styles are Sass, so your project's style language has to be too:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  styleLang: 'scss', // ← was 'css' (the default)
  // …
});
~~~

Rename your existing component stylesheets to match — `src/app/app.css` → `src/app/app.scss`. Plain CSS
is valid Sass, so their contents need no change.

## 3. Emit the theme from a GLOBAL stylesheet

Create the stylesheet that pulls in the library:

~~~scss title="src/styles/main.scss"
@use 'pkg:@weave-framework/ui' as weave;

@include weave.theme(); // the design tokens, on :root
@include weave.all-styles(); // the component CSS that reads them
~~~

…and register it as a **global** entry — this line is what makes it work:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'], // ← global: compiled first, unscoped
});
~~~

:::callout warn "It must be a global entry, not a component stylesheet"
Component styles are **scoped**: every selector is rewritten to match only the elements that component
renders. Put the theme in `src/app/app.scss` and `:root { --weave-… }` becomes `[data-w-xxxxxx]:root`,
a selector that can never match — so no token is ever defined, and every component renders unstyled
while ~120 KB of CSS ships. The compiler warns when it scopes a `:root`/`html`/`body` rule, and the fix
is always the same: move it to a global stylesheet listed in `styles`.
See [Styling → app-wide styles](/learn/styling#app-wide-styles).
:::

## 4. Import components and use them

Each component is a default export on its own subpath:

~~~ts title="src/app/app.ts"
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

export function setup() {
  const save = (): void => {
    /* … */
  };
  return { save };
}
~~~

~~~html title="src/app/app.html"
<Button variant="primary" on:click={{ save }}>Save</Button>
~~~

That's it — the button is themed, keyboard-accessible, and reads the tokens you can now retune from one
place.

## Shipping less CSS

`all-styles()` emits the CSS for **every** built-in component. It is the simplest start; once you know
what you use, pull the components' Sass entries individually instead:

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
You imported the component but not its stylesheet. Every component needs **two** lines, and they live in
different files:

~~~ts title="the component, in your .ts"
import Button from '@weave-framework/ui/button';
~~~
~~~scss title="its styles, in your .scss"
@use 'pkg:@weave-framework/ui/button';
~~~

Miss the second and you get correct, accessible, completely unstyled markup. That is the single most
common first problem, and it is deliberate: styles are opt-in per component so an app ships only the CSS
it uses.
:::

**The theme is missing, so everything is slightly wrong.** `@use 'pkg:@weave-framework/ui' as weave;`
plus the theme emit belongs in a **global** stylesheet, once. Put it in a component's `.scss` and the
tokens are scoped to that component — every other component then falls back, and the symptom is colours
and spacing that are *almost* right rather than obviously broken.

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
