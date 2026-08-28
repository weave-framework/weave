# Weave app

A [Weave](https://weaveframework.dev/) app — signal-native, no Virtual DOM, zero third-party runtime
dependencies.

```bash
npm install
npm run dev      # http://localhost:5173, reloads on save
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server: watch, rebuild, live-reload |
| `npm run build` | A deployable static bundle in `dist/` |
| `npm run check` | Type-check your components, templates **and** the rest of your `.ts` |

## What's here

```
weave.config.ts     the build's single source of truth (root component, shell, output)
src/
  index.html        the HTML shell — Weave injects the script and stylesheet itself
  app/
    app.ts          the root component: a `setup()` that returns what the template may read
    app.html        its template
    app.css         its styles — scoped to this component automatically
```

A **component** is a `.ts` exporting `setup`, plus a sibling `.html` (and optional stylesheet). No class,
no decorator, no registration. Add one by creating the two files:

```ts
// src/app/greeting/greeting.ts
export function setup(props: { name: string }) {
  const name = () => props.name; // a getter, so it stays live
  return { name };
}
```

```html
<!-- src/app/greeting/greeting.html -->
<p>Hello, {{ name() }}</p>
```

Then use it from a parent template — a tag starting with a capital letter is a component:

```html
<Greeting name="world" />
```

Import it in the parent's `.ts` (`import Greeting from './greeting/greeting';`) and `npm run check` can
type-check the props you pass.

## Adding the UI component library

The scaffold is deliberately bare. Buttons, inputs, dialogs, tables and the rest live in a separate
package, and its styles are Sass — so there are four steps, not one:

```bash
npm install @weave-framework/ui sass
```

1. Set `styleLang: 'scss'` in `weave.config.ts` and rename `src/app/app.css` → `src/app/app.scss`.
2. Create `src/styles/main.scss` with the theme:

   ```scss
   @use 'pkg:@weave-framework/ui' as weave;

   @include weave.theme(); // the design tokens, on :root
   @include weave.all-styles(); // the component CSS that reads them
   ```

3. Register it as a **global** stylesheet in `weave.config.ts` — this line is what makes it work:

   ```ts
   styles: ['src/styles/main.scss'],
   ```

   It must be a global entry, not a component stylesheet: component styles are scoped, and scoping a
   `:root` block gives you a selector that can never match.

4. Import components per subpath and use them:

   ```ts
   import Button from '@weave-framework/ui/button';
   ```

   ```html
   <Button on:click={{ save }}>Save</Button>
   ```

Full list and theming knobs: [weaveframework.dev/ui](https://weaveframework.dev/ui/theming).

## Deploying

`npm run build` writes plain `.html`, `.js` and `.css` to `dist/` — host it anywhere static. If you add
the router with clean URLs, configure the host to fall back to `index.html` for unknown paths (an SPA
rewrite), or a deep-link refresh returns 404.

## Learn more

- [Quick start](https://weaveframework.dev/learn/quick-start)
- [Thinking in signals](https://weaveframework.dev/learn/signals)
- [Templates](https://weaveframework.dev/learn/templates) · [Components](https://weaveframework.dev/learn/components)
- [Router](https://weaveframework.dev/learn/router) · [Forms](https://weaveframework.dev/learn/forms) · [Data](https://weaveframework.dev/learn/data)
