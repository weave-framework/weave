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

> **On `npm install`:** npm may warn that `esbuild` and `@parcel/watcher` have install scripts "not yet
> covered by allowScripts". Both are build tooling — esbuild bundles your app, `@parcel/watcher` powers
> `weave dev`'s file watching — and neither ships in what your users download. `pnpm` is pre-approved for
> them by the `pnpm-workspace.yaml` in this folder; npm prints the notice and installs anyway.

## What's here

```
weave.config.ts     the build's single source of truth (root component, shell, output)
src/
  index.html        the HTML shell — Weave injects the script and stylesheet itself
  app/
    app.ts          the root component: a `setup()` whose locals the template may read
    app.html        its template
    app.css         its styles — scoped to this component automatically
```

A **component** is a `.ts` exporting `setup`, plus a sibling `.html` (and optional stylesheet). No class,
no decorator, no registration. `npx weave add component Greeting` writes the files for you; by hand it
is the two files:

```ts
// src/app/greeting/greeting.ts
export function setup(props: { name: string }) {
  const name = () => props.name; // a getter, so it stays live
  // no return: the compiler reads the template and exposes what it uses
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
package. Two steps:

```bash
npm install @weave-framework/ui
```

1. Add the library's stylesheet as a **global** entry in `weave.config.ts` — the theme and every
   component's CSS, prebuilt, no Sass:

   ```ts
   styles: ['@weave-framework/ui/weave-ui.css'],
   ```

2. Import components per subpath and use them:

   ```ts
   import Button from '@weave-framework/ui/button';
   ```

   ```html
   <Button on:click={{ save }}>Save</Button>
   ```

Retheme from plain CSS — every token is a custom property: `:root { --weave-color-accent: #b25dff; }`
in a global stylesheet of your own recolours every component. A fully custom theme, or shipping only the
components you use, is the Sass route: [weaveframework.dev/ui/installation](https://weaveframework.dev/ui/installation).

## Deploying

`npm run build` writes plain `.html`, `.js` and `.css` to `dist/` — host it anywhere static.

- **Client routes:** with `routesDir` set, the build also writes `404.html` (a copy of the shell), which is
  what makes a deep-link refresh work on GitHub Pages. On a host with rewrite rules, point unknown paths at
  `index.html` instead.
- **Not at the domain root?** Set `base: '/my-app/'` in `weave.config.ts` — a GitHub Pages *project* site
  lives under the repository name, and without `base` the page comes up blank.

## Learn more

- [Quick start](https://weaveframework.dev/learn/quick-start)
- [Thinking in signals](https://weaveframework.dev/learn/signals)
- [Templates](https://weaveframework.dev/learn/templates) · [Components](https://weaveframework.dev/learn/components)
- [Router](https://weaveframework.dev/learn/router) · [Forms](https://weaveframework.dev/learn/forms) · [Data](https://weaveframework.dev/learn/data)
