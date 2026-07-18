---
name: weave-tooling
description: >-
  The Weave toolchain — CLI, config, type-checking, editor setup, Nx, scaffolding,
  and testing. Use this whenever you run or configure the build/dev loop or wire up
  a Weave project: `weave dev/build/check`, `weave.config.ts` (root, styleLang,
  dev.proxy), `npm create weave`, the `@weave-framework/nx` plugin and mixed
  Nx workspaces, editor tooling (typescript-plugin / VS Code / WebStorm /
  prettier), custom-element output, or testing a Weave app. Reach for it on any
  mention of build errors, dev server, `weave check`, tsconfig/editor red squiggles,
  Nx, scaffolding, "why won't it compile", or "set up the project".
---

# Weave toolchain

Weave compiles templates to DOM code via an esbuild-based pipeline. The CLI owns
dev/build/check; `weave.config.ts` owns bootstrap (there is no `main.ts`). Verify
every change with `weave check` — types flow through the template.

## CLI

```bash
weave dev            # dev server (HMR); component .ts/.html/.scss hot-reload
weave build          # production build → dist/ (index.html, main.js, app.css)
weave build --ssg    # prerender each route to a real index.html (static generation)
weave check          # type-check every component against its template (run before commit)
weave routes <dir>   # (re)generate routes.gen.ts from a pages dir; --eager for static imports
weave mcp            # run the Weave MCP server over stdio (AI-editor integration)
```
Flags: `--config <file>`, `--out <dir>`, `--port <n>`, `--no-minify`. `--out` overrides the config's `outDir`.
`weave check` is the gate: it builds a virtual TS module per component (the verbatim `setup` + a template harness typed against `ReturnType<typeof setup>`) and reports template type errors mapped back to the `.html`/`.weave` line. A template name that doesn't resolve, a wrong prop type, a bad event handler — all surface here.

## Config (`weave.config.ts`)

```ts
import { defineConfig } from '@weave-framework/cli';
export default defineConfig({
  root: 'src/app/app',            // root component — Weave generates the bootstrap
  index: 'src/index.html',        // HTML shell
  outDir: 'dist',
  publicDir: 'public',            // static assets copied in
  styleLang: 'scss',              // component sibling styles are <base>.scss (default 'css')
  dev: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },   // proxy backend calls in dev
  },
});
```
- **`styleLang`** picks ONE sibling extension (`css`/`scss`/`sass`) — no filesystem probing.
- **`dev.proxy`** forwards matching requests to a backend during `weave dev`.
- **`routesDir`** turns on file-based routing (`routes.gen.ts` is regenerated before each build/dev).
- **`ssg: { routes, resume }`** configures `weave build --ssg`. `routes` defaults to the static routes derived from `routesDir` (or `/`). `resume: true` is the islands build — the server embeds a state snapshot and the client **adopts** the server DOM, so `setup` never re-runs and static content ships no JS. `--ssg` requires a `root` config (it renders the root headlessly); an `entry` config opts out. Request-time SSR/streaming is deliberately not built.
- **`root` vs `entry`** are mutually exclusive and one is REQUIRED — the config throws if you declare neither or both.
- **Custom elements**: a component that `export const tag = 'my-widget'` auto-registers as a custom element (use it as `<my-widget>` anywhere, including outside Weave).

## Scaffolding

```bash
npm create weave@latest my-app     # scaffolds config, root component, tsconfig, the Weave skill suite, editor setup
```
Works with npm/pnpm/yarn. The scaffold includes a project-local `tsconfig.json` (scopes the app as its own Weave TS program) and the `typescript-plugin` wiring.

## Editor tooling (get types + template support in your IDE)

Add the plugin so the IDE understands components (default export synthesis, template-only imports, template checking):

```jsonc
// tsconfig.json
{ "compilerOptions": { "plugins": [{ "name": "@weave-framework/typescript-plugin" }] } }
```
- **`@weave-framework/typescript-plugin`** — tsserver plugin: fixes `import X from './x-component'` (**TS1192** "no default export") and stops "unused import" on template-only component imports. **VS Code** bundles it via the extension; **WebStorm** needs the tsconfig `plugins` entry above + Restart TypeScript Service.
- **Language server** (Volar-based) — template hover / go-to-definition / diagnostics on `.html`/`.weave`. It is **bundled inside** the VS Code extension and the WebStorm plugin; it is not a package you install yourself, so never add it to `package.json`.
- **`@weave-framework/prettier-plugin`** — formats `.weave`/Weave templates (map `*.html` → `weave` in `.prettierrc` in a Weave project).

If a component `.ts` is red with TS1192, or `.html` shows native/other-framework errors, it's almost always a missing plugin/mapping — not a code bug. `weave check` is the source of truth for real type errors.

## Nx & mixed workspaces

`@weave-framework/nx` provides inferred targets, executors (`build`/`serve`/`check`), and generators (app/component). In a **mixed workspace** (Weave beside projects using other tooling, including one being converted to Weave), a project keeps behaving the way it did until its own config says otherwise. Three markers flip a project to Weave, plus a `project.json` target override:

1. `weave.config.{ts,js,json}` at the project root,
2. a project-local `tsconfig.json`,
3. `.prettierrc` mapping `*.html` → `weave`,
4. `project.json` targets using `@weave-framework/nx:build|serve|check` (a declared target outranks any inferred one).

Once the project no longer declares the old framework's targets (and its `.ts` aren't `@Component`-decorated), the editor's Weave support owns the `.html`. `nx show project <p> --web` reveals which plugin each target comes from.

## Testing

Weave components/behavior are best tested against a **real DOM** (the framework's own suite runs `*.browser.ts` in headless Chromium). For an app: mount a component into a host node, drive it (dispatch events, set signals), and assert on the resulting DOM — no VDOM to reason about. Signals make setup deterministic (`setup` runs once; `await tick()` flushes reactive updates). Reach for `@weave-framework/data`/store fakes at the seams (inject a fake client/store) rather than mocking the framework.

## MCP

`@weave-framework/mcp` exposes the toolchain (compile/check/routes/scaffold) to AI editors over MCP — useful when an AI assistant should drive Weave tasks programmatically.

## The dev loop (do this per change)

1. Edit component `.ts`/`.html`/`.scss` — HMR reloads (a change under `src/styles/**` needs a `weave dev` restart).
2. Run **`weave check`** — must be clean (this is where template type errors show).
3. Verify behavior in the running app.

## Gotchas

- **No `main.ts`** — `weave.config.ts` `root` is the entry.
- **`weave check` is the type gate**, not the editor alone — CI should run it.
- Editor red on a component that `weave check` passes → a missing `typescript-plugin`/prettier mapping, not a bug.
- `styleLang` binds ONE style extension per project — a `.scss` sibling needs `styleLang: 'scss'`.
