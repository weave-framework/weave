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

## Where to next

- Every token and knob — [Styling & theming](/ui/theming)
- The components themselves → start with [Button](/ui/button)
- How scoping works in your own styles — [Styling](/learn/styling)
