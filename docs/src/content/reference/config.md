# Configuration

`weave.config.ts` is the single source of truth for a Weave build. The CLI reads it for `dev`, `build`, and route generation — there are no long `--out`/`--serve` flags to remember. For a guided walkthrough see [Quick start](/learn/quick-start) and [Tooling & CLI](/learn/tooling); this page is the exhaustive option list.

## Defining the config

Use the typed helper for autocomplete and inline validation. `defineConfig` is an identity function — it returns its argument unchanged and exists purely so TypeScript checks and infers the shape:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave-framework/cli';

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

The helper is optional — a plain `export default { … }` (or, in `.json`, a bare object) works identically. You lose only the editor autocomplete and type errors.

## File resolution

The config is auto-discovered in the working directory, or pointed at explicitly with `--config <path>`. When auto-discovering, Weave looks for these names **in order and stops at the first match**:

| Order | File | How it's read |
|-------|------|---------------|
| 1 | `weave.config.ts` | Compiled on the fly with esbuild, imported via a `data:` URL (no temp file). |
| 2 | `weave.config.js` | Same as `.ts`. |
| 3 | `weave.config.mjs` | Same as `.ts`. |
| 4 | `weave.config.json` | Parsed directly with `JSON.parse` — no compile step, no `defineConfig`. |

If none of the four exist (and none was given via `--config`), `loadConfig` returns `null` and the CLI reports that no config was found. An explicit `--config <path>` that does not exist is also treated as "no config".

:::callout info "How TS/JS configs are compiled"
A `.ts`/`.js`/`.mjs` config is bundled with esbuild (`packages: 'external'`, so your `node_modules` stay external) and the `@weave-framework/cli` import is shimmed to a tiny `defineConfig = (c) => c` identity. That keeps the whole CLI and esbuild out of the bundle, so loading the config is cheap. The result is imported from an in-memory `data:` URL — nothing is written to disk.
:::

### Path resolution

All relative paths in the config are resolved against the **directory containing the config file**, not the current working directory. Absolute paths are passed through unchanged. This applies to every path option: `root`, `entry`, `index`, `publicDir`, `outDir`, `routesDir`, and each entry in `styles`.

## Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `root` | `string` | — | Root component module (relative to the config). Weave **generates** the entry, mounts it, and auto-registers custom elements. **Mutually exclusive with `entry`.** |
| `entry` | `string` | — | Hand-written entry module — the escape hatch when you want to write the bootstrap yourself. **Mutually exclusive with `root`.** |
| `mount` | `string` | `'#app'` | CSS selector the generated root mounts into. **Only meaningful with `root`; ignored when `entry` is used.** |
| `index` | `string` | — | HTML shell template. Weave injects the entry `<script>` and the stylesheet `<link>` at build/dev time. |
| `publicDir` | `string` | the config-file directory | Static web root — served as-is in dev and copied verbatim into the build output. |
| `outDir` | `string` | `'dist'` | Output directory for `weave build`. |
| `styleLang` | `'css' \| 'scss' \| 'sass'` | `'css'` | Component style language. The loader pairs each component with its sibling `<base>.<styleLang>` — no probing of other extensions. |
| `routesDir` | `string` | — (off) | File-based routing directory. When set, `weave build`/`dev` regenerate `routes.gen.ts` from it before bundling. |
| `styles` | `string[]` | `[]` | Global entry stylesheets, compiled and concatenated in order (first = base) **before** component CSS. |
| `dev.port` | `number` | — (auto) | Dev-server listen port. When unset, the dev server picks a port. |
| `dev.proxy` | `Record<string, string \| ProxyRule>` | — (off) | Dev-server proxy table — forward matching request paths to a backend so API calls stay same-origin. See below. |
| `build.minify` | `boolean` | `true` | Minify the production JS/CSS bundle. |
| `ssg.routes` | `string[]` | derived (see below) | Routes to prerender with `weave build --ssg` — one `index.html` each. |
| `ssg.resume` | `boolean` | `false` | Opt into the islands build: the server embeds a per-instance state snapshot and the client **adopts** the server DOM in place. See below. |

There is no separate "enable routing" flag: routing is on exactly when `routesDir` is set. Likewise there is no "disable minify" flag beyond setting `build.minify: false`.

## `ssg` — static generation

`weave build --ssg` renders the root component headlessly to real HTML and writes an `index.html` per route. The `ssg` key configures it; the `--ssg` flag is what turns it on (there is no config flag that enables SSG on its own).

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  routesDir: 'src/pages',
  ssg: { routes: ['/', '/about', '/pricing'], resume: true },
});
~~~

**Which routes are prerendered** — the first of these that applies:

1. `ssg.routes`, when you set it explicitly;
2. otherwise every static route derived from `routesDir` (dynamic segments like `[id]` are not prerendered);
3. otherwise just `/`, for a root-only app.

**`--ssg` requires `root`.** It renders the root component, so a config using the hand-written `entry` escape hatch opts out and the build fails with a message saying so.

**`ssg.resume`** switches both the client and server entries into the islands build. Instead of the default first-paint-shell plus a client-side remount, the server embeds a state snapshot and the client adopts the existing DOM: `setup` never re-runs, and static content ships no JavaScript. Leave it `false` (the default) for the plain prerendered-shell behaviour.

See [Static generation](/learn/static-generation) for the full walkthrough. Rendering per request (request-time SSR and streaming) is deliberately not built.

## `dev.proxy` — forward API calls to your backend (dev only)

In dev the app is served from `http://localhost:<port>`, but your backend API usually runs on another origin. Calling it directly is cross-origin — CORS preflights, and friction for cookie auth. `dev.proxy` forwards matching request paths to the backend so calls stay **same-origin** (no CORS, `HttpOnly` cookies just work). It applies to the dev server only; a production build is already same-origin.

```ts
// shorthand — forward everything under /api to the backend
dev: { port: 5300, proxy: { '/api': 'http://localhost:5201' } }

// full form — strip the /api prefix before forwarding
dev: {
  proxy: {
    '/api': { target: 'http://localhost:5201', changeOrigin: true, rewrite: { '^/api': '' } },
  },
}
```

A request is proxied when its path **equals** a key or starts with `key + '/'` — so `/api` matches `/api` and `/api/x` (and `/api?q=1`), but **not** `/apiary`. The first matching key wins, and the check runs before Weave's own routes (the live-reload endpoint, `/main.js`, static assets, the SPA shell), so a prefix like `/api` always takes precedence.

Each value is either a `target` origin (shorthand) or a rule:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `target` | `string` | — | Backend origin, e.g. `'http://localhost:5201'`. |
| `changeOrigin` | `boolean` | `true` | Send the target's host in the forwarded `Host` header. |
| `rewrite` | `Record<string, string>` | — | Path rewrites applied in order — `new RegExp(source)` → replacement. Rewrites the path only; the query string is preserved. |

The request (method, headers, body, query) is streamed to the backend and the response piped back unchanged, so `Cookie` (up) and `Set-Cookie` (down) pass through both ways. If the backend can't be reached the dev server replies `502` and stays up.

## You must declare `root` or `entry` (fail-loud)

These two options choose your bootstrap style, and the config validator enforces a strict either/or:

- Declaring **neither** throws:

  > `weave: config must declare either \`root\` (generated bootstrap) or \`entry\` (hand-written)`

- Declaring **both** throws:

  > `weave: config declares both \`root\` and \`entry\` — pick one`

The error is raised while resolving the config, so the CLI fails immediately — there is no silent fallback or precedence rule. Pick exactly one.

| You want… | Use | What Weave does |
|-----------|-----|-----------------|
| Weave to own the bootstrap (recommended) | `root` | Generates the entry: imports the root, registers every `export const tag` custom element, then `mountComponent(Root, mount)`. You write no entry file and no `<script>` tag. |
| To hand-write the bootstrap | `entry` | Imports your module as-is. You call `mountComponent` yourself (e.g. to register a service worker, add a polyfill, or mount somewhere unusual). `mount` is **ignored** — the mount point is wherever your code puts it. |

See [Custom elements & bootstrap](/learn/custom-elements) for both styles.

## A minimal shell

With `root` set, the HTML shell only needs a mount point matching `mount`:

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

## `publicDir` defaults to the config directory

When `publicDir` is omitted it defaults to the **directory the config lives in**, not a `public/` subfolder.

:::callout tip "Consequence: a bare config serves your whole project"
With no `publicDir`, the static web root is the config directory itself — so the dev server and the build will expose every file alongside `weave.config.ts` (source included). For anything beyond a throwaway demo, set `publicDir` to a dedicated folder such as `'public'`.
:::

## Generated files

The toolchain emits `*.gen.ts` files that regenerate on each build and should be git-ignored: `routes.gen.ts` (from `routesDir`), and — for the docs site itself — `content.gen.ts` / `api.gen.ts`. Generated modules are never treated as components.

:::callout info "See also"
[Quick start](/learn/quick-start) · [Tooling & CLI](/learn/tooling) · [Router](/learn/router) (file-based routing) · [Styling](/learn/styling) (global vs scoped styles)
:::
