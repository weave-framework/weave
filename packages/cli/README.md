# @weave-framework/cli

The Weave CLI — `weave build` (add `--ssg` for static generation), `weave dev` (watch + live-reload), `weave check`, `weave routes`, `weave mcp`.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/cli
```

## Commands

| Command | What it does |
|---------|--------------|
| `weave build` | Bundle the app for production. `--ssg` also prerenders every route to HTML. |
| `weave dev` | Dev server: watch, rebuild, live-reload. |
| `weave check` | Type-check the project, templates included. |
| `weave routes` | Regenerate the file-based route module from `routesDir`. |
| `weave mcp` | Start the Weave MCP server over stdio, for MCP-capable AI editors. |

```
usage: weave <build|dev|check|routes|mcp> [entry|paths…] [--config file] [--out dir]
             [--serve dir] [--port n] [--no-minify] [--eager] [--ssg]
```

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
  dev: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
```

Also available: `mount` (selector, default `#app`), `entry` (single-entry mode instead of `root`), `styles`, and `build: { minify }`. An explicit `--out` overrides the config's `outDir`.

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
