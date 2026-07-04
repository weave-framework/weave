# Tooling & CLI

Weave ships its own toolchain — a single `weave` CLI for building, serving, type-checking, and route generation, plus first-class editor support. No bundler config to assemble, no plugin soup. This page walks through every command, every flag, and the two pipelines that hide behind them.

## Running the CLI

Install `@weave-framework/cli` as a dev dependency (the [scaffold](/learn/installation) does this for you), and the `weave` command is available in your project. Run it through your `package.json` scripts or `npx`:

~~~bash
npm run dev        # if you have a "dev": "weave dev" script
npx weave build    # or invoke it directly
npx weave check
npx weave routes
~~~

Everywhere below we write `weave <cmd>` for short — that's the command as it runs from your project's scripts or `npx`. See [Installation](/learn/installation) for setup.

## The two pipelines

Here's the one thing that explains almost everything else. Every command checks for a config file first, and that single fact decides which of two pipelines you get:

- **Config-driven** — when a `weave.config.ts` (or `.js`, `.mjs`, `.json`) exists in the current directory, or you point at one with `--config <path>`. The config is the source of truth: `dev` and `build` run Weave's full pipeline (framework-owned entry, file-based routes, global styles, HTML-shell injection). This is the mode you want.
- **Legacy / flag-driven** — when there's *no* config at all. The commands fall back to a bare, flag-driven pipeline with hardcoded defaults (entry `src/main.ts`, output `dist`, serve dir `.`). It's kept around for fixtures and quick one-off bundling, and it behaves noticeably differently in `dev`. If you didn't mean to be here, you forgot a config file.

The config is auto-discovered in the current working directory. `--config <path>` works on **every** command and forces the config-driven pipeline by pointing at an explicit file.

## The four commands

| Command | What it does |
|---------|--------------|
| `weave dev` | Watch, rebuild, and serve with live-reload |
| `weave build` | One-shot production bundle into `dist/` (or `outDir`) |
| `weave check` | Static type-check of your templates and components |
| `weave routes` | Generate the file-based route module from a pages dir |

Below, each command's flags are spelled out in full. Where a flag only matters in one pipeline, the table says so.

### weave dev

Starts a watching dev server with live-reload. **Which server you get depends on the pipeline:**

- **Config mode** — Weave runs its *own* in-memory HTTP server (bound to `127.0.0.1`). Nothing is written to disk: the JS bundle is served from memory, component CSS self-injects, and your global `styles` ride in on a JS banner that appends one `<style>` tag. Static assets (favicons, manifest, fonts) are read live from `publicDir`. Your `index.html` is a clean shell — the framework injects the entry `<script>` and the live-reload client for you, so you never hand-write that boilerplate. Routes regenerate from `routesDir` before serving.
- **Legacy mode** — esbuild's *own* `serve` over a static `servedir`. On every rebuild it writes the collected component CSS to `outdir/app.css` (so here `dev` *does* touch disk). esbuild's `fallback` serves `servedir/index.html` for unmatched routes.

In both modes a request with no file extension falls back to the HTML shell, so client-side routing and deep-link refreshes survive. Live-reload itself is a Server-Sent-Events channel (in-memory mode) or esbuild's built-in reload (legacy).

| Flag | Pipeline | Default | Effect |
|------|----------|---------|--------|
| `--config <path>` | both | auto-discover | Point at an explicit config file; forces config mode. |
| `[entry]` (positional) | legacy | `src/main.ts` | The hand-written entry module. The first non-`-` argument. Ignored in config mode (the config's `entry`/`root` wins). |
| `--serve <dir>` | legacy only | `.` | Static web root esbuild serves from. No effect in config mode (uses `publicDir`). |
| `--port <n>` | legacy only | esbuild picks | Server port. **In config mode this CLI flag is ignored** — set the port with `dev.port` in the config instead. |

:::callout info "Two different ports"
There are two separate port knobs and they don't cross over. The `--port <n>` *CLI flag* only takes effect in legacy mode. In config mode the port comes from `dev.port` in `weave.config.ts`, and the CLI flag is not read. If you set one and nothing changes, you're probably in the other mode.
:::

:::callout tip "If a template-only edit seems ignored"
The dev server watches your `.ts`, `.html`, and `.scss`/`.sass`. Editing a SCSS partial that's pulled in via `@use`/`@import` rebuilds the components that depend on it, because the loader tracks those loaded files. But a codegen-time change — a brand-new route file, new `.md` content, a freshly-added config option — runs at startup, so it needs a restart. When in doubt, restart `weave dev`.
:::

### weave build

Produces a static bundle you can deploy. Both pipelines minify by default and code-split `lazy()` chunks into their own files (so `<Link>` prefetch has something to warm). What differs is how much they assemble:

- **Config mode** — the full artifact. It wipes `outDir` clean first, regenerates routes from `routesDir`, generates the framework-owned entry, compiles your global `styles` first then component CSS into one `app.css`, copies `publicDir` verbatim, and injects the entry `<script>` + stylesheet `<link>` into a copy of your `index` shell. The result is a self-contained, deployable `dist/`.
- **Legacy mode** — a bare bundle. It bundles the entry, writes component CSS to `app.css`, and that's it: no clean, no `publicDir` copy, no `index` injection, no global styles, no route regen.

| Flag | Pipeline | Default | Effect |
|------|----------|---------|--------|
| `--config <path>` | both | auto-discover | Point at an explicit config file; forces config mode. |
| `[entry]` (positional) | legacy | `src/main.ts` | The hand-written entry module. Ignored in config mode. |
| `--out <dir>` | legacy | `dist` | Output directory. **In config mode this flag is ignored** — set `outDir` in the config instead. |
| `--no-minify` | legacy | minified | Skip minification (handy for inspecting output). In config mode, control this with `build.minify` in the config. |

### weave check

Static type-checking for your templates — the thing a plain bundler can't do. It runs the same in both pipelines (it doesn't load the config at all; it just takes root paths). Covered in full in [its own section below](#type-checking-templates-weave-check).

| Flag | Default | Effect |
|------|---------|--------|
| `[paths…]` (positional) | `['src']` | One or more root directories to check. Every non-`-` argument is a root. |

~~~bash
weave check            # checks src/ by default
weave check src lib    # multiple roots
~~~

It exits non-zero when there are errors, so it drops straight into CI as a gate.

### weave routes

Regenerates the file-based route module from a pages directory. You rarely run this by hand — `build` and `dev` do it for you when `routesDir` is configured — but it's a standalone command so you can wire it into other scripts.

It scans the directory recursively for page files (`.weave`, `.ts`, `.tsx`, `.js`, `.jsx`), skipping generated and declaration files (`*.gen.ts`, `*.d.ts`) and sibling templates/styles, builds the route manifest, and writes `routes.gen.ts`. **Routes are lazy by default** — each page becomes a `lazy()` import so it code-splits into its own chunk.

| Flag | Default | Effect |
|------|---------|--------|
| `[dir]` (positional) | `src/routes` | The pages directory to scan. The first non-`-` argument. |
| `--out <dir>` | `<dir>/routes.gen.ts` | Where to write the generated module. |
| `--eager` | lazy | Inline each page directly instead of wrapping it in `lazy()` — no code-splitting. |

~~~bash
weave routes                    # scan src/routes → src/routes/routes.gen.ts (lazy)
weave routes src/pages          # different pages dir
weave routes src/pages --out src/router/routes.gen.ts
weave routes src/pages --eager  # inline, no per-route chunks
~~~

## weave.config.ts

One config file is the source of truth for the config-driven pipeline. Every option:

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `root` | `string` | — | Root component module. Weave generates the entry, mounts it, and auto-registers custom elements. *Mutually exclusive with `entry`.* |
| `entry` | `string` | — | Hand-written entry module (custom bootstrap). *Mutually exclusive with `root`.* |
| `mount` | `string` | `'#app'` | CSS selector the root component mounts into (used with `root`). |
| `index` | `string` | — | HTML shell; Weave injects the entry script + stylesheet link. |
| `publicDir` | `string` | the config dir | Static web root — served live in dev, copied verbatim into the build. |
| `outDir` | `string` | `'dist'` | Output directory for `weave build`. |
| `styleLang` | `'css' \| 'scss' \| 'sass'` | `'css'` | Component style language; the loader pairs `<base>.<styleLang>` with no probing. |
| `routesDir` | `string` | — | Pages directory; routes regenerate before each build/dev. |
| `styles` | `string[]` | `[]` | Global stylesheets, compiled and concatenated *before* component CSS. |
| `dev.port` | `number` | esbuild picks | Dev server port (config mode only). |
| `build.minify` | `boolean` | `true` | Minify the production bundle. |

Define it with the typed helper for autocomplete:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave-framework/cli';

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

The config can be `weave.config.ts`, `.js`, `.mjs`, or `.json`. TS/JS configs are compiled on the fly with esbuild and imported via a `data:` URL — no temp file, no build step. The `defineConfig` import is swapped for a tiny inline identity function during that compile, so loading the config never pulls in the whole CLI.

### styleLang: all three are real

`styleLang` isn't decoration — each value drives genuinely different compilation:

| Value | What happens |
|-------|--------------|
| `css` | Zero-cost passthrough — the file is read as-is, no compiler involved. A pure-CSS app never loads Sass at all. |
| `scss` | Compiled with Sass using standard SCSS syntax (braces and semicolons). |
| `sass` | Compiled with Sass using the **indented** syntax (no braces, whitespace-significant). |

Sass is a *lazy* dependency: it's only imported the first time a `.scss`/`.sass` source is actually compiled. The component loader pairs each component with its sibling style file by extension (e.g. `button.ts` → `button.scss`) with no probing, so the `styleLang` you set is exactly the extension it looks for.

## Type-checking templates: weave check

`weave check` type-checks your templates against your code — the thing a plain bundler can't do. For each component it builds a virtual TypeScript module that places every template expression against `ReturnType<typeof setup>`, then checks it all in one strict program. Diagnostics map back to the exact `.html` line and column, printed as `file:line:col - error TS<code>: message`.

It catches:

- **Bad template expressions** — a typo'd binding, calling a non-function, a wrong type inside `{{ }}`, `@if`, `@for`, `@let`, or `@await`.
- **Child-component prop contracts** — a parent's `<Child prop={{ expr }}>` is checked against the child's `setup` first parameter, so passing the wrong prop type (or omitting a required prop) is an error at the usage site.
- **Directive references** — `use:` and `transition:` names must resolve to something real.
- **Template-only imports** — an import used *only* in the template isn't falsely flagged as unused.

Pass one or more roots; with none, it defaults to `['src']`. Any error makes it exit non-zero, so it's a drop-in CI gate.

## Editor support

Weave has real IDE integration — red squiggles on type errors *inside templates*, hover, completion, go-to-definition, and rename across the `.ts`/`.html` boundary. It's powered by a shared [Volar](https://volarjs.dev) language server, so the same engine backs every editor.

> **Where to get the plugins.** They are **not on the VS Code Marketplace or the JetBrains Marketplace yet** — you install them from a file. Download the latest build from the repo's [`plugins/editor/`](https://github.com/weave-framework/weave/tree/main/plugins/editor) folder:
> - VS Code → [`plugins/editor/vscode/weave-language-0.5.0.vsix`](https://github.com/weave-framework/weave/tree/main/plugins/editor/vscode)
> - WebStorm → [`plugins/editor/webstorm/weave-webstorm-0.13.0.zip`](https://github.com/weave-framework/weave/tree/main/plugins/editor/webstorm)
>
> (Use whatever the newest version in those folders is.)

### VS Code

1. Download the `.vsix` file (above).
2. Install it — either from the terminal:
   ```bash
   code --install-extension weave-language-0.5.0.vsix
   ```
   …or from the UI: open the **Extensions** panel → click the **⋯** menu at the top → **Install from VSIX…** → pick the file.
3. Reload VS Code (**Developer: Reload Window**, or just restart it).
4. Open a component — a `.weave` file, or a `.html` template whose sibling `.ts` exports a `setup`. Type errors in the template now show red squiggles, and hover / go-to-definition work across the `.ts`↔`.html` boundary.

That's it. The extension registers the `.weave` and `weave-html` languages, ships syntax highlighting, and wires the Weave TypeScript plugin into VS Code's TypeScript service automatically.

### WebStorm / JetBrains

WebStorm needs **two** things — a host plugin and the Weave plugin:

1. **Install LSP4IJ** (the Weave plugin runs on top of it): **Settings → Plugins → Marketplace**, search **LSP4IJ**, install, and let WebStorm restart.
2. **Install the Weave plugin from disk:** **Settings → Plugins** → click the **gear icon** → **Install Plugin from Disk…** → pick the downloaded `weave-webstorm-*.zip` → restart when prompted.
3. **Enable type-checking on the `.ts` side** (one-time per project): add the Weave TypeScript plugin to your `tsconfig.json` so WebStorm's own TypeScript service loads it —
   ```json
   {
     "compilerOptions": {
       "plugins": [{ "name": "@weave-framework/typescript-plugin" }]
     }
   }
   ```
   then **restart the TypeScript service** (**Settings → Languages & Frameworks → TypeScript**, or right-click a `.ts` file → *TypeScript → Restart TypeScript Service*).
4. Open a `.weave` or component `.html` file — diagnostics, hover, and go-to-definition light up.

> **Why the extra `tsconfig` step?** WebStorm only loads tsserver plugins listed in `tsconfig.json` (VS Code injects it for you). Without step 3 you'd get a spurious *"Module … has no default export"* error on component imports.

### Under the hood

Two pieces do the work, both reusing the same virtual-module machinery as `weave check`:

- **`@weave-framework/language-server`** — a Volar LSP server (TypeScript + CSS services) used by both editors. It reports template diagnostics on the `.html` side.
- **`@weave-framework/typescript-plugin`** — a tsserver plugin that takes over component `.ts` files (and `.weave` SFCs) so imports used only in templates aren't marked unused, and a parent's import of a child resolves the child's typed props.

## DevTools: inspecting the reactive graph

Weave ships a zero-dependency, in-app DevTools panel for looking at your live reactive graph — every **named** `signal`/`computed`/`effect`, its current value, and which sources trigger it. It's off unless you turn it on, so production pays nothing.

~~~ts
import { enableDevtools, mountDevtoolsPanel, signal } from '@weave-framework/runtime';

enableDevtools();                          // BEFORE creating signals (unnamed nodes never register)
const count = signal(0, { name: 'count' }); // name a node to surface it
mountDevtoolsPanel();                       // floating overlay; returns a disposer
~~~

The panel updates live with no polling (it reads the graph inside an effect), filters by name, and shows each node's dependencies (`← count`) so you can see *who triggers whom*. For programmatic access, `inspect()` returns a snapshot of all named nodes and `inspectGraph()` returns nodes **plus edges**. Gate the calls behind a dev flag (e.g. `import.meta.env.DEV`) so nothing ships to production.

:::callout info "What you just learned"
One `weave` CLI does it all — once `@weave-framework/cli` is a dev dependency you run it as `weave <cmd>` (via `npm run`/`npx`). The four commands are `dev` (watch + live-reload), `build` (static `dist/`), `check` (template + child-prop type-checking), and `routes` (file-based route gen). The big idea: a `weave.config.ts` switches `dev`/`build` into the full config-driven pipeline, while no config drops you into a bare legacy flag-driven one — and `dev` behaves quite differently between them (in-memory server vs esbuild's serve, port from config vs `--port`). Flags like `--config`, `--out`, `--serve`, `--port`, `--no-minify`, and `--eager` each belong to a specific command and pipeline. `styleLang` really compiles `css`/`scss`/`sass` differently, and editor support is a shared Volar server behind a VS Code extension and a WebStorm/LSP4IJ plugin.
:::

[Next: Recipes →](/learn/recipes) · [Reference: configuration →](/reference/config) · [Installation →](/learn/installation)
