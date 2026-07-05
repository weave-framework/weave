# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

## 1.0.12 — 2026-07-05

### ✨ Feature — `weave dev` proxy (`dev.proxy`)
- **`weave dev` can now proxy API calls to your backend, so they stay same-origin** (no CORS,
  and `HttpOnly` cookie auth just works). Config it like Vite/Angular/Next:
  ```ts
  dev: { proxy: { '/api': 'http://localhost:5201' } }                     // shorthand
  dev: { proxy: { '/api': { target: '…', changeOrigin: true, rewrite: { '^/api': '' } } } }
  ```
  A request is proxied when its path equals a key or starts with `key + '/'` (so `/api` matches
  `/api` and `/api/x`, but not `/apiary`); the first match wins and runs before Weave's own dev
  routes. The request (method/headers/body/query) is streamed to the backend and the response
  piped back unchanged, so `Cookie` and `Set-Cookie` pass through both ways; `changeOrigin`
  (default `true`) sets the forwarded `Host`, and `rewrite` rewrites the path only (the query is
  preserved). An unreachable backend returns `502` without crashing the dev server. Dev-only —
  production builds are already same-origin. Built on Node's `http`/`https`, no new dependencies.

## 1.0.10 — 2026-07-05

### 🐛 Fix — `@weave-framework/ui` is now consumable from a real app
- **The documented `import Button from '@weave-framework/ui/button'` now works for real npm consumers.** The ui
  library was built with plain `tsc`, so every component shipped UNCOMPILED — `export const template` /
  `export function setup`, no `render`, and no **default export**. A real consumer's `weave build` failed with
  *"No matching export for default"* and `weave check` with *TS1192*. (The monorepo masked it: dev exports resolve
  to `src` and the loader compiles on the fly.) The ui build now compiles each component at build time through the
  same `compileComponent` the loader uses, so dist ships `export default defineComponent(render, setup)` plus a
  props-typed default in its `.d.ts` — `Parameters<typeof Button>[0]` is the component's props. `weave check` also
  gained `esModuleInterop` + `resolveJsonModule`. A new `verify:ui-consume` gate proves consumption against the
  built dist for all 29 components (and fails on the old plain-tsc output).

### 🔧 Infrastructure — docs deploy moved to Cloudflare
- **The documentation site (weaveframework.dev) now deploys to Cloudflare Workers** instead of GitHub Pages, whose
  backend had begun intermittently rejecting deployments with a terminal *"Deployment failed, try again later."*
  (the build always passed; only the Pages deploy step flaked). It now uses the same reliable static-assets path
  as the flagship demo, still gated on a `[publish]` commit so the docs stay in lockstep with npm. No user-facing
  change to the framework.

## 1.0.5 — 2026-07-05

### 🐛 Fixes — scaffolded starter type error
- **The generated starter now type-checks.** Every scaffolder (`create-weave`, the `@weave-framework/nx`
  application/component generators, and the `@weave-framework/mcp` scaffold tool) emitted
  `const inc = (): void => count.set((n) => n + 1);` — but `count.set(...)` returns the new value, so an
  expression-body arrow annotated `(): void` fails with *`TS2322: Type 'number' is not assignable to type 'void'`*.
  Changed to a block body: `const inc = (): void => { count.set((n) => n + 1); };`.
- **New gate:** the `create-weave` starter template is now type-checked in CI (`typecheck` runs its `tsconfig`), so
  a scaffolded app that doesn't compile can no longer ship.

## 1.0.4 — 2026-07-05

### 🐛 Fixes — `@weave-framework/nx` generators
- **`nx g @weave-framework/nx:application` (and `:library`) no longer crash at the end with *"task is not a
  function"*.** The generators returned the project-root string; Nx calls a generator's return value as a task
  callback, so a non-function threw. They now return the install task (a callback).
- **Generated projects get their `@weave-framework/*` dependencies.** The scaffold imports `runtime` (and, for
  apps, the full `router`/`store`/`forms`/`i18n`/`data` set) plus the `cli` dev dependency — the generators now add
  them to `package.json` (mirroring `create-weave`) and install them.
- **The scaffolded `.html` templates keep their Weave `{{ }}` bindings.** `formatFiles` (Prettier) was mangling
  `on:click={{ inc }}` into `on:click="{{" inc }}`; templates are now written *after* formatting so they survive
  verbatim.

## 1.0.3 — 2026-07-05

### 🐛 Fixes
- **`@weave-framework/nx` works with `nx g` / target inference again.** The plugin's `exports` map didn't expose
  `./package.json`, so Nx — which resolves `@weave-framework/nx/package.json` to discover its generators — failed
  with *"Package subpath './package.json' is not defined by exports"*. Added `"./package.json"` to the exports map
  (and, defensively, to every `@weave-framework/*` package) so the manifest is always resolvable. A regression test
  now pins it.
- Fixed stale **"pre-1.0"** copy in the Installation and Quick start docs — Weave is 1.0.

## 1.0.2 — 2026-07-05

### 🐛 Fixes
- **`npm create weave@latest` now scaffolds a 1.0 app.** The starter template pinned `@weave-framework/*` at
  `^0.2.0`, so a fresh project resolved to the old `0.2.x` line instead of 1.0. Bumped the template ranges to
  `^1.0.0`.

## 1.0.0 — 2026-07-05 🎉

**Weave is 1.0.** The public API is now **stable and frozen** — from here, breaking changes only ever
land in a major version, deprecated-first, per [VERSIONING.md](VERSIONING.md). Everything you build on the
documented surface won't change out from under you.

This release is the freeze itself; the features it stabilises shipped across the `0.2.x` line (see `0.2.162`
below and [CHANGELOG.md](CHANGELOG.md) for the full history): the signal-native runtime with no Virtual DOM,
the compiler + template syntax, Router v2, Forms v2 (incl. schema-driven forms), i18n, the data layer,
DevTools, the full `@weave-framework/ui` component library, and the `mcp` + `nx` toolchain packages.

### 🔒 API freeze (what changed for 1.0)
- **Deliberate public surface** ([RFC 0005](rfcs/0005-api-surface-audit.md)) — audited to **151 documented
  exports**. The ~29 compiler-emitted `runtime/dom` helpers (`bindText`, `ifBlock`, `mountChild`, …) are now
  `@internal`: still exported for generated code, but excluded from the reference and carrying **no** stability
  promise. Their signatures stay free to change; your code never imports them directly.
- **Every public export is documented** — the API reference reports zero undocumented public exports.
- **`VERSIONING.md`** states the promise: it covers documented exports, component props, the template syntax,
  and the UI token / ARIA contract; breaking changes are major-only, deprecated first, kept until at least the
  next major.

### 🔧 Internal / CI
- The docs site deploys only on a `[publish]` release, in lockstep with npm — the documentation never runs
  ahead of the installable packages.

## 0.2.162 — 2026-07-05 (`0.2.108`–`0.2.162`)

The largest batch since the last npm release — Phase C, all Tier-2 template features, and four
new dedicated capabilities. Two brand-new packages: **`@weave-framework/mcp`** and **`@weave-framework/nx`**.

### ✨ Features
- **Router v2** (RFC 0003) — the router owns its signals + `useRouter()`; a typed `route()` builder with
  `RouteParamsOf<Path>` param inference; route-level `loader` + `useLoaderData()` (reuses `@await` v2); native
  **View Transitions**.
- **DevTools** — a live in-app panel (`mountDevtoolsPanel()`): named signals/computeds/effects with values, a
  dependency graph (who triggers whom), a temporal **trigger-trace** (`inspectTrace`/`traceFor`), and a
  **component/owner tree** (`inspectTree`) — Nodes / Trace / Tree tabs. Zero-cost when off.
- **Tier-2 template features** — `<Teleport>` (alias of `<Portal>`), `<Dynamic is>`, state-preserving
  `<KeepAlive>`, reactive `style:prop` / `style:--custom`, and reactive `use:` actions (`ActionResult { update, destroy }`).
- **Forms v2** — `dirty()` / pristine across field/group/fieldArray, plus **schema-driven forms**
  (`@weave-framework/forms/schema`): a `fieldType()` registry + `schemaForm()` builder over the existing
  primitives, with 8 built-in field types and a render model.
- **`@weave-framework/mcp`** — a Model Context Protocol server exposing the toolchain to AI editors as tools
  (`weave_compile_template`, `weave_check`, `weave_routes`, `weave_scaffold_component`). In-house JSON-RPC over
  stdio, zero third-party deps. Launch with `weave mcp` or the `weave-mcp` bin.
- **`@weave-framework/nx`** — an Nx plugin: inferred (crystal `createNodesV2`) `build`/`serve`/`check` targets with
  correct cache inputs/outputs, matching executors, and `application` / `library` / `component` generators.
- **`@await` v2** — reactive source (re-enters pending + awaits a new Promise on a dependency change); **transition
  lifecycle callbacks** `on:enterstart/enterend/leavestart/leaveend`.
- **Benchmarks** — a vanilla-baselined harness + a `/learn/performance` methodology page (~1.4× vanilla geomean).

### ♿ Accessibility / i18n
- **Full RTL** — bidi keyboard (key-manager `rtl` option + per-component swaps) and logical-CSS / positioning
  across the component library.

### 🐛 Fixes
- SVG `<path d={{ }}>` and other SVG-only fragment roots now compile and paint (namespace-aware `templateSvg()`).
- Docs sidebar highlights exactly one item — a section-root link (e.g. Examples "Overview") no longer stays
  active on its child routes (`Link` now supports `exact`).

### 🔧 Internal / CI
- The docs site (`weaveframework.dev`) now deploys only on a `[publish]`-marked release, in lockstep with npm — so
  the documentation never gets ahead of the packages you can install. Ordinary pushes still validate the build.
- `pnpm-lock.yaml` synced with the new `@weave-framework/nx` dependencies (fixes `--frozen-lockfile` CI failures).

## 0.2.107 — 2026-07-04

The first npm release since `0.2.53` — it bundles the full accessibility audit, new icon
capabilities, several correctness/performance fixes, and the now-complete UI documentation.

### ✨ Features
- **`<ButtonToggle>` per-segment icon** — an option can carry an `icon` (`{ value, label, icon }`), rendered as a
  composed `<Icon>` before the label.
- **Built-in Lucide icon set grown to 53** — added `sun`, `moon`, `copy`, `git-branch`, `graduation-cap`,
  `book-open`, `package`; every name works from `<Icon name="…">` with zero configuration.

### ♿ Accessibility
- A structural a11y audit across all 37 styled components (roles/states, keyboard, focus, reduced-motion, RTL) —
  **7 test-pinned ARIA fixes**: `aria-controls` lifecycle on Select / Autocomplete / Datepicker, Timepicker
  `aria-valuemin/max`, over-mode Sidenav `aria-modal`, Table resize-grip `aria-valuenow/min`, and Space-to-select
  on the Select listbox.
- A central `prefers-reduced-motion` mixin collapses every library transition/animation (including the infinite
  Progress-Bar and Spinner loops) when the user prefers reduced motion.

### 🐛 Fixes
- Composed child components resolve correctly in a real consumer build — including a `<Checkbox>` nested inside
  `@if`/`@for` (e.g. `<Table selectable>`) and the case where a JSDoc import example was mistaken for a real import.
- Template interpolation no longer scope-prefixes the keys of an inline object literal.
- `weave dev` no longer accumulates duplicate `<style>` tags across client-side navigation — style injection is
  idempotent now (content-hashed id + skip-if-present), so long dev sessions stay responsive.

### 🔒 Security
- `weave dev`'s static-file handler rejects path traversal (403 instead of reading outside the served dir), and
  polynomial-backtracking regex shapes were removed from the router basename normalizer and the compiler extractor.

### 📚 Docs & packaging
- The whole `@weave-framework/ui` component library is documented (38 component pages + a Styling/theming guide),
  each with live demos importing the real component; the docs site itself now dogfoods the UI library for its own
  chrome. Every package ships a README on npm.

## 0.2.54 — 2026-07-03

Security hardening — resolves the code-scanning findings on the published packages. No API change.

### 🔒 Security
- `weave dev`'s static-file handler **rejects path traversal** — a requested asset that resolves outside the
  served directory now returns 403 instead of reading the file.
- Removed polynomial-backtracking regex shapes: the router's `basename` normalizer uses a plain trailing-slash
  trim, and the compiler's `template`/`styles` extractor bounds its optional type-annotation match to one line.

## 0.2.53 — 2026-07-03

Correctness, composition, and security hardening across the core — the first `@weave-framework/*`
bump since the 0.2.0 npm release.

### 🧩 Components
- Component-level `on:X` handlers now auto-forward to the rendered root element, so
  `<Button on:click={{…}}>` works with no event re-declaration inside the component.
- A composed component's data-callback prop (e.g. a child's `onChange`) fires **exactly once** —
  the earlier double-invoke (data callback *and* event auto-forward) is fixed.

### 🐛 Fixes

- `computed()` values are now released together with the component that created them —
  a memo reading a long-lived signal (router, i18n, store) no longer leaks its subscription.
- A `computed()` that throws no longer caches and silently returns a stale value; it
  re-evaluates on the next read.
- `<Select>` reflects changes to its `options` while the panel is open (e.g. async-loaded
  results) and renders fresh on every re-open.
- Template interpolation correctly handles a `}}` inside a string literal and inner object
  literals.
- The template compiler resolves bindings inside template-literal `${ … }` and expands object
  shorthand (`{ name }` → `{ name: … }`).
- A loop variable no longer shadows same-named component data elsewhere in the same template.
- Numeric `bind:value` no longer clobbers a value while it is being typed.
- `validators.pattern` is deterministic when given a global (`/g`) regular expression.

### ⚡ Performance

- Fewer redundant updates: block and component construction no longer over-subscribe to
  unrelated signals, and `@for` row updates are batched into a single pass.

### 🔒 Security

- `<Icon>` sanitizes SVG before rendering — event-handler attributes, `<script>`,
  `<foreignObject>`, and `javascript:` URLs are stripped. A dynamic `<w:element>` refuses to
  create a `<script>` element.

### 📦 Scaffold (`create-weave`)
- `npm create weave@latest` now includes every feature package (router, store, forms, i18n,
  data) as a dependency — each is zero-dep and tree-shaken when unused, so there is no bundle
  cost and no need to install a feature mid-project. The template ships a `pnpm-workspace.yaml`
  that pre-approves the esbuild / parcel-watcher build scripts, so `pnpm install` doesn't prompt.
