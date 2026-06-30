# Tooling & CLI

Weave ships its own toolchain — a single `weave` CLI for building, serving, type-checking, and route generation, plus first-class editor support. No bundler config to assemble, no plugin soup.

## The CLI

Four commands cover the whole workflow:

~~~bash
weave dev      # dev server: watch + live-reload
weave build    # minified static bundle in dist/
weave check    # type-check templates and components
weave routes   # generate file-based routes
~~~

All of them read `weave.config.ts` when present (or accept `--config <path>` to point elsewhere).

### weave dev

Runs Weave's own in-memory dev server: it bundles to memory (nothing written to disk), serves your `publicDir` static assets, and pushes a live-reload over a Server-Sent-Events channel on every rebuild — saved edits reload the page. Routes without a file extension fall back to your HTML shell, so client-side routing and deep-link reloads work. Set the port with `dev.port` in the config.

:::callout tip "If a template-only edit seems ignored"
The dev server watches your `.ts`, `.html`, and `.scss`. Occasionally a freshly-added SCSS partial or a codegen-time change (new route file, new `.md` content) needs a restart, because some generation runs at startup. When in doubt, restart `weave dev`.
:::

### weave build

Produces a clean, self-contained `dist/`: it clears the output dir, compiles global styles first then component CSS, code-splits `lazy()` chunks, and minifies by default (`--no-minify` to skip). With `root` set, it generates the entry and injects the script + stylesheet into your `index` shell.

### weave check

Static type-checking for your templates — covered in its own section below.

### weave routes

Regenerates the file-based route module from a pages directory: `weave routes src/pages` (defaults to `src/routes`). Writes `routes.gen.ts` next to it (`--out` to relocate); routes are lazy by default (`--eager` to inline them). You rarely run this directly — `build`/`dev` do it for you when `routesDir` is configured.

## weave.config.ts

One config file is the source of truth for the whole build. Every option:

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `root` | `string` | — | Root component module. Weave generates the entry, mounts it, registers custom elements. *Mutually exclusive with `entry`.* |
| `entry` | `string` | — | Hand-written entry module (custom bootstrap). *Mutually exclusive with `root`.* |
| `mount` | `string` | `'#app'` | CSS selector the root mounts into (with `root`). |
| `index` | `string` | — | HTML shell; Weave injects the entry script + stylesheet. |
| `publicDir` | `string` | config dir | Static web root, served in dev and copied into the build. |
| `outDir` | `string` | `'dist'` | Output directory for `weave build`. |
| `styleLang` | `'css' \| 'scss' \| 'sass'` | `'css'` | Component style language (sibling extension). |
| `routesDir` | `string` | — | Pages directory; routes regenerate before each build/dev. |
| `styles` | `string[]` | `[]` | Global stylesheets, compiled + concatenated first. |
| `dev.port` | `number` | auto | Dev server port. |
| `build.minify` | `boolean` | `true` | Minify the production bundle. |

Define it with the typed helper for autocomplete:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave/cli';

export default defineConfig({
  root: 'src/app/shell',
  index: 'src/index.html',
  publicDir: 'public',
  routesDir: 'src/pages',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'],
  dev: { port: 5173 },
});
~~~

The config can be `weave.config.ts`, `.js`, `.mjs`, or `.json`; TS/JS configs are compiled on the fly.

## Type-checking templates: weave check

`weave check` type-checks your templates against your code — the thing a plain bundler can't do. For each component it builds a virtual TypeScript module that places every template expression against `ReturnType<typeof setup>`, and checks it all in one strict program. Diagnostics map back to the exact `.html` line and column:

~~~bash
weave check            # checks src/ by default
weave check src lib    # specific roots
~~~

It catches:

- **Bad expressions** — a typo'd binding, calling a non-function, a wrong type in `{{ }}`, `@if`, `@for`, `@let`, `@await`.
- **Child-component prop contracts** — a parent's `<Child prop={{ expr }}>` is checked against the child's `setup` first parameter, so passing the wrong prop type (or a missing required prop) is an error at the usage site.
- **Directive references** — `use:` and `transition:` names must resolve.
- **Template-only imports** — an import used solely in the template isn't falsely flagged as unused.

It exits non-zero when there are errors, so it drops straight into CI as a gate.

## Editor support

Weave has real IDE integration — red squiggles on type errors *inside templates*, hover, completion, go-to-definition, and rename across the `.ts`/`.html` boundary. It's powered by a shared [Volar](https://volarjs.dev) language server, so the same engine backs every editor.

### VS Code

Install the **Weave** extension (`weave-language`). It registers the `.weave` and `weave-html` languages, ships the TextMate grammar for syntax highlighting, and wires the Weave TypeScript plugin into VS Code's TypeScript service. It activates on `.weave` files, and on `.html` files whose sibling `.ts` exports a `setup` — so your component templates light up automatically.

### WebStorm / JetBrains

Install the Weave plugin (it relies on the **LSP4IJ** plugin to host the language server). It maps `*.weave` and component `*.html` files to the Weave languages and registers the shared `@weave/language-server` for diagnostics and navigation.

### Under the hood

Two pieces do the work, both reusing the same virtual-module machinery as `weave check`:

- **`@weave/language-server`** — a Volar LSP server (TypeScript + CSS services) used by both editors. It reports template diagnostics on the `.html` side.
- **`@weave/typescript-plugin`** — a tsserver plugin that takes over component `.ts` files (and `.weave` SFCs) so imports used only in templates aren't marked unused, and a parent's import of a child resolves the child's typed props.

:::callout info "What you just learned"
One `weave` CLI does it all: `dev` (in-memory server + live-reload + SPA fallback), `build` (minified `dist/`), `check` (template + child-prop type-checking), `routes` (file-based route gen). `weave.config.ts` is the single source of truth — `root` vs `entry`, `routesDir`, `styleLang`, global `styles`, and more. Editor support is a shared Volar server: a VS Code extension and a WebStorm/LSP4IJ plugin give you in-template type errors, hover, and navigation.
:::

[Next: Recipes →](/learn/recipes) · [Reference: configuration →](/reference/runtime)
