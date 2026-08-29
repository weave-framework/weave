# @weave-framework/cli

The Weave CLI — `weave build` (add `--ssg` for static generation), `weave dev` (watch + live-reload), `weave check`, `weave routes`, `weave migrate`, `weave mcp`.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/cli
```

## Commands

| Command | What it does |
|---------|--------------|
| `weave build` | Bundle the app for production. `--ssg` also prerenders every route to HTML. |
| `weave dev` | Dev server: watch, rebuild, live-reload. |
| `weave check` | Type-check the project, templates included, and report template mistakes that compile clean but fail silently. `--fix` repairs the ones with exactly one right answer; `--impact <file>` lists what renders a component. |
| `weave routes` | Regenerate the file-based route module from `routesDir`. |
| `weave migrate` | Assisted migration of an existing Angular app into this one. Reads your source project, writes a plan, then the converted code. |
| `weave mcp` | Start the Weave MCP server over stdio, for MCP-capable AI editors. |

```
usage: weave <build|dev|check|routes|migrate|mcp> [entry|paths…] [--config file] [--out dir]
             [--serve dir] [--port n] [--no-minify] [--eager] [--ssg] [--fix]
```

`weave --help` (or `-h`, or no command) prints the full help; `weave dev` steps to the next free port when the
one it wants is taken; and a finished `weave build` lists what it emitted, with sizes.

`weave check` also reports the template mistakes that compile clean and fail silently — a listener bound as a
plain attribute, a misspelled DOM event or block keyword, an unknown binding prefix — each at its own line in
the template file. They are warnings, so they do not fail the command. `weave check --fix` applies the ones
with exactly one right answer and re-checks; a rule that could plausibly mean more than one thing never
guesses.

## Configuration

A `weave.config.ts` in the working directory (or `--config <file>`) switches `build` and `dev` into the config-driven pipeline; without one, the flags drive a single-entry build.

```ts
// weave.config.ts
import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/app',     // the root component — Weave generates the bootstrap
  index: 'src/index.html', // HTML shell; Weave injects the script + styles
  publicDir: 'public',     // static assets copied into the build
  outDir: 'dist',
  routesDir: 'src/pages',  // opt into file-based routing
  styleLang: 'scss',
  base: '/my-app/',        // only when the app is not served from the domain root
  dev: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
```

Also available: `mount` (selector, default `#app`), `entry` (single-entry mode instead of `root`), `styles`, and `build: { minify }`. An explicit `--out` overrides the config's `outDir`.

### Deploying

`base` is what makes a sub-path deploy work — a GitHub Pages *project* site, a reverse proxy, `/docs/`. Every
URL the framework injects carries it, `weave dev` answers under it, and the router adopts it as its basename,
so `<Link to="/about">` is still written as `/about` and resolves to `/my-app/about`.

The injected `<script>` and `<link>` also carry a content marker (`/main.js?v=1a2b3c`), so a CDN cannot answer
fresh HTML with a stale bundle. An app with `routesDir` additionally gets a **`404.html`** — a copy of the
shell, which is what a static host serves for an unknown path and therefore what makes a deep-link refresh
work where rewrite rules are not available.

## Static generation

`weave build --ssg` renders every route to real HTML at build time — painted on arrival, crawlable, and served
as plain files with no server in the request path. Routes are derived automatically from `routesDir` (override
with `ssg.routes`) and each page is its own chunk, so a reader downloads the page they opened rather than your
whole site.

```bash
npx weave build --ssg
```

`--ssg` needs a config with a `root` component — that's what it renders headlessly.

Add `ssg: { resume: true }` to `weave.config.ts` and the browser **resumes** that HTML instead of rebuilding
it: the build snapshots the reactive graph into the page, the client re-attaches the existing DOM to it, and
`setup()` never runs on the client.

```ts
export default defineConfig({
  root: 'src/app/shell',
  routesDir: 'src/pages',
  ssg: { resume: true },
});
```

Both are opt-in: a plain `weave build` is unchanged, and a SPA-only app ships none of this. Anything that
cannot resume client-renders instead, and says so at build time with the binding, the file and the cause.
See **[Static generation & resume](https://weaveframework.dev/learn/static-generation)**.

Scaffolded apps already include the CLI, with the scripts wired up:

```bash
npm create weave@latest my-app
```

📚 **Guides + full API reference:** [Tooling guide](https://weaveframework.dev/learn/tooling) · [Config reference](https://weaveframework.dev/reference/config)

## License

MIT
