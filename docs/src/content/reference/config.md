# Configuration

`weave.config.ts` is the single source of truth for a Weave build. The CLI reads it for `dev`, `build`, and route generation. For a guided walkthrough see [Quick start](/learn/quick-start) and [Tooling & CLI](/learn/tooling); this page is the exhaustive option list.

## Defining the config

Use the typed helper for autocomplete and validation:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave/cli';

export default defineConfig({
  root: 'src/app/shell',
  index: 'src/index.html',
  publicDir: 'public',
  outDir: 'dist',
  routesDir: 'src/pages',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'],
  dev: { port: 5173 },
  build: { minify: true },
});
~~~

The config may be `weave.config.ts`, `.js`, `.mjs`, or `.json`. It's auto-discovered in the working directory, or pointed at explicitly with `--config <path>`. TS/JS configs are compiled on the fly. All paths are relative to the config file.

## Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `root` | `string` | — | Root component module (no extension). Weave generates the entry, mounts it, and auto-registers custom elements. **Mutually exclusive with `entry`.** |
| `entry` | `string` | — | Hand-written entry module (custom bootstrap escape hatch). **Mutually exclusive with `root`.** |
| `mount` | `string` | `'#app'` | CSS selector the root mounts into (only with `root`). |
| `index` | `string` | — | HTML shell template. Weave injects the entry `<script>` and the stylesheet `<link>` at build/dev time. |
| `publicDir` | `string` | config dir | Static web root — served in dev, copied verbatim into the build output. |
| `outDir` | `string` | `'dist'` | Output directory for `weave build`. |
| `styleLang` | `'css' \| 'scss' \| 'sass'` | `'css'` | Component style language; the sibling style file is `<name>.<styleLang>`. |
| `routesDir` | `string` | — | File-based routing directory. When set, `weave build`/`dev` regenerate `routes.gen.ts` before bundling. |
| `styles` | `string[]` | `[]` | Global entry stylesheets, compiled and concatenated **before** component CSS (first = base). |
| `dev.port` | `number` | auto | Dev-server listen port. |
| `build.minify` | `boolean` | `true` | Minify the production JS/CSS bundle. |

## root vs entry

Pick exactly one bootstrap style:

- **`root`** (recommended) — point it at your top component and Weave writes the entry for you: import the root, register any `export const tag` custom elements found in the project, then `mountComponent(Root, mount)`. You write no entry file and no `<script>` tag.
- **`entry`** — point it at a module you wrote yourself (e.g. to register a service worker, add a polyfill, or mount somewhere unusual). You call `mountComponent` by hand.

See [Custom elements & bootstrap](/learn/custom-elements) for both.

## A minimal shell

With `root` set, the HTML shell only needs a mount point:

~~~html title="src/index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My app</title>
  </head>
  <body>
    <div id="app"></div>
    <!-- Weave injects the entry script + stylesheet here -->
  </body>
</html>
~~~

## Generated files

Three `*.gen.ts` files are produced by the toolchain and should be git-ignored (they regenerate on each build): `routes.gen.ts` (from `routesDir`), and — for the docs site itself — `content.gen.ts` / `api.gen.ts`. Generated modules are never treated as components.

:::callout info "See also"
[Quick start](/learn/quick-start) · [Tooling & CLI](/learn/tooling) · [Router](/learn/router) (file-based routing) · [Styling](/learn/styling) (global vs scoped styles)
:::
