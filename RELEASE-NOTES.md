# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### ✨ Features — `@weave-framework/ui`

- **Tabs — custom tab-button content (`tabTemplate`).** Hand `<Tabs>` an authored `@snippet` and it
  renders the whole content of each `role="tab"` button — an icon before the label, a badge, two
  lines — from each tab's `TabRowContext` (`item` + your `data` payload, `label`, `index`, reactive
  `selected`, `disabled`). The framework still owns the button, ARIA, roving tabindex and panels;
  `label` stays the accessible name. `<Tabs>`/`TabItem` are now generic over the payload
  (`data?: T`). Omit `tabTemplate` for the default label span — fully back-compatible. Mirrors the
  menu's `itemTemplate` (FW-10/FW-12).

### 🔒 Security

- **prettier-plugin — ReDoS hardening.** The `<script>`/`<style>`/`lang` detection regexes in the
  plugin's `parse.ts` no longer use the ambiguous `(\s[^>]*)?` form that CodeQL flagged as polynomial
  backtracking (5 `js/polynomial-redos` alerts). They now use a zero-width `(?=[\s>])` assertion and
  read `lang` from the captured `<style>` attributes, not a second whole-document scan. Formatting
  behaviour is unchanged.

## 1.5.0 — 2026-07-07

Everything since **1.4.0** (developed locally as `1.4.1`→`1.4.22` in batch mode, released here as a
single **minor** — new public API across `ui`, `runtime` and `i18n`).

### ✨ Features — `@weave-framework/ui`

- **Input — password/secret reveal (`revealable`).** An opt-in eye toggle that flips an
  `<input type="password">` to text and back; composes `<Icon>` (eye / eye-off), is a real
  `type="button"` with `aria-pressed`, and is i18n-labelled (`revealLabel` / `hideLabel`).
  Companion props: **`onRevealToggle(shown)`** (notified on each toggle) and
  **`revealTooltip`** (`'none' | 'native' | 'weave'`) choosing the toggle's tooltip — `'native'`
  is a plain `title`, `'weave'` lazily mounts the CDK tooltip. Opt-in: nothing renders without
  `revealable`.
- **Menu / Context Menu — richer rows.** Three additive options, all preserving keyboard nav,
  typeahead (`optionLabel`), ARIA, `disabled`, `divider` and positioning:
  - **`selected`** — a value picker: the row equal to it is marked `role=menuitemradio` +
    `aria-checked` with a leading check. Pass a getter so the mark tracks the value (re-read on
    every open).
  - **`optionContent(item) => Node`** (FW-9) — custom row body (a flag, icon, swatch, avatar)
    in place of the default label; `optionLabel` still drives the accessible name + typeahead.
  - **`itemTemplate(row) => Node`** (FW-10) — an authored `@snippet` that renders the **whole**
    row from the full row context (`item`, `checked`, reactive `active()`, `index`, `disabled`),
    owning the layout, marker (position + icon) and selected/active styling. `selected` still
    sets the ARIA; the visible marker becomes the template's job.

### ✨ Features — runtime & i18n

- **`@weave-framework/runtime` — Observable↔signal bridge.** `fromObservable(obs, initial)` and
  `toObservable(signal)` interop with any `Symbol.observable` / `.subscribe` source (RxJS, etc.)
  with no dependency added.
- **`@weave-framework/i18n` — standalone Intl formatters.** `formatNumber` / `formatCurrency` /
  `formatPercent` / `formatDate` / `formatRelativeTime` / `formatList` — the zero-dep replacement
  for Angular pipes, usable in `.ts` and templates, honouring the active locale.

### 🐞 Fixes — `@weave-framework/compiler`

- **`use:` config object literals now compile.** A reactive binding expression that is an object
  literal (`use:tip={{ { placement: 'top' } }}`) was read as a statement block; expressions are
  now parenthesized at every binding site.
- **Object spread/rest is scope-rewritten.** `{ ...opts, … }` inside a template expression left
  `opts` as a bare global (the `...` was mistaken for a member `.`), so
  `use:menu={{ { ...menuOpts, itemTemplate: row } }}` silently lost its options. Both the rewriter
  and auto-scope inference now recognise a spread argument as a data reference.
- **Self-closing SVG tags stay siblings (FW-8).** A self-closing foreign-content element
  (`<path/>`, `<circle/>`) is serialized with an explicit close tag, so following siblings no
  longer nest inside it.

### 🐞 Fixes — `@weave-framework/cli`

- **`styles` url() assets are emitted + served (FW-7).** Relative `url(...)` references in compiled
  CSS (fonts, images) are hashed, copied into the build, and served in dev — previously they
  404'd because only the CSS text was bundled.

### 📚 Docs

- **Per-component example galleries** for all 38 `@weave-framework/ui` components under
  Examples → Components (each a live, full-option-surface page).
- **Menu and Context Menu galleries** for `selected`, `optionContent` and `itemTemplate`.

## 1.4.0 — 2026-07-06

### ✨ Feature — `@weave-framework/router`: async before-leave guards (unsaved-changes prompts)
- **New `beforeEach(fn)` — an async, cancellable guard that runs before every navigation commits**
  (push, replace, *and* browser back/forward). Route `guard`s are synchronous by design (great for
  auth), so there was no point at which navigation could pause to **await a user decision** — which is
  exactly what an *"you have unsaved changes, really leave?"* prompt on a routed page needs. `beforeEach`
  fills that gap:
  - The guard receives `LeaveInfo { to, from, type }` and returns `boolean | Promise<boolean>` — return
    `false` (or `Promise<false>`) to cancel; the current path and the address bar stay put.
  - **All registered guards must allow** for a navigation to proceed; the first `false` short-circuits.
    `beforeEach(fn)` returns an unregister function — call it in the page's cleanup so the guard only
    lives while that page is mounted.
  - **Browser back/forward is handled too:** on a cancelled `pop` the router rolls history back
    (`history.go`) so the URL matches staying put — no "content old, address new" half-state.
  - `afterEach` fires only on a **committed** navigation (never on a cancelled one); the synchronous
    route guards and matching are unchanged and run only after before-leave allows.
- **New `navigate(to, { replace: true })`** (and the `NavigateOptions` type) — swap the current history
  entry instead of pushing, via `history.replaceState`. This promotes the previously internal-only
  `'replace'` `NavType` to real public API.
- When **no** `beforeEach` guard is registered, navigation stays fully synchronous — existing behavior
  and timing are unchanged.

## 1.3.2 — 2026-07-06

### 🐞 Fix — a template parse error points at the file, not a stack trace
- **`weave check` and `weave build` now surface a malformed template as a clean `file:line:col`
  diagnostic.** 1.3.1 stopped the infinite-loop / OOM on a bad attribute (e.g. `<div }>` or a
  leftover Angular-style `(click)` / `[prop]`), but still dumped a raw parser stack trace with no
  filename. Now:
  - `weave check` prints `path/app.html:2:8 - error: Unexpected character "}" in attributes of <div>`,
    and one bad template no longer aborts the whole check — it becomes an ordinary diagnostic.
  - `weave build` frames the error at the template with the offending source line + caret and fails
    with a concise `weave build failed — N errors.` instead of esbuild's internal stack.
  `ParseError` now carries a structured source offset, so the tools that know the filename can map it
  precisely.

## 1.3.1 — 2026-07-06

### 🐞 Fixes — Nx integration & the template parser
- **`@weave-framework/nx`: builds now land at the Nx-conventional `dist/<project>`.** The `build`
  executor defaults its output to `<workspaceRoot>/dist/<projectRoot>` (matching every other Nx
  plugin) instead of the app-local `dist/`, and the app generator scaffolds
  `"outputs": ["{workspaceRoot}/dist/{projectRoot}"]` so Nx caching restores files to the right
  place. A project can still override via `outputPath` in `project.json`. Standalone (non-Nx)
  `weave build` is unchanged — internally an explicit `--out` now overrides the config's `outDir`,
  which is the seam the executor uses.
- **`@weave-framework/nx`: the `build` executor is now actually published.** A `.gitignore` `build/`
  rule (meant for build output) silently swallowed `packages/nx/src/executors/build/`, so the
  executor's source was never committed and `nx build` failed with *"Unable to resolve
  @weave-framework/nx:build."* The source is un-ignored and shipped, and a smoke test now asserts
  every executor declared in `executors.json` has a non-ignored source and resolves on disk.
- **The template parser no longer hangs / OOMs on a malformed attribute.** A stray character the
  attribute scanner can't consume (e.g. `}` from a Prettier-mangled `router="{{" router }}`) used to
  spin the parse loop forever until Node ran out of memory (~5 GB). It now fails fast with a clear
  `Unexpected character '}' in attributes of <RouterView> (line N, col M)`.

### ✨ Scaffolded apps format their Weave templates
- **`nx g @weave-framework/nx:application` wires up `@weave-framework/prettier-plugin`** — the new
  app gets it as a devDependency plus a `.prettierrc` routing `.html` to the `weave` parser, so
  `{{ }}` bindings format correctly instead of being mangled by a Weave-unaware Prettier.

## 1.3.0 — 2026-07-06

### ✨ New package — `@weave-framework/prettier-plugin`
- **A Prettier plugin for Weave templates.** Prettier's stock HTML parser throws on the first Weave
  token (`SyntaxError: Opening tag "Button" not terminated`), so until now the only workaround was to
  `.prettierignore` your templates — meaning the files you edit most never got formatted. This plugin
  makes `.weave` SFCs and Weave-template `.html` files first-class Prettier citizens: `{{ }}`
  interpolation, `@if`/`@for`/`@switch`/`@defer`/`@await` control flow, and every binding kind
  (`on:`/`bind:`/`use:`/`class:`/`style:`/`ref`/`.prop`). Format-on-save, `prettier --check` in CI,
  and pre-commit hooks all work on templates again.
- **It reuses the compiler's own parser** rather than shipping a separate grammar, so the formatter can
  never drift from what actually compiles. Embedded `{{ }}` expressions are formatted by delegating to
  Prettier's `typescript` printer; a `.weave` SFC's `<script>`/`<style>` blocks go through the
  `typescript`/`css`/`scss` printers. Output is idempotent, and `@@` escaping / comments / binding
  kinds are preserved.
- **`.weave` files are picked up automatically.** Route Weave `.html` templates to the `weave` parser
  with a Prettier `overrides` entry so plain HTML elsewhere is untouched:
  ```jsonc
  { "plugins": ["@weave-framework/prettier-plugin"],
    "overrides": [{ "files": "src/**/*.html", "options": { "parser": "weave" } }] }
  ```
  See [Tooling → Formatting templates](https://weaveframework.dev/learn/tooling#formatting-templates-prettier).
- **Whitespace is conservative by design** in this first release: block structure is reindented and
  expressions are formatted, but inline text runs are not aggressively reflowed (and `<pre>`/`<textarea>`
  are left verbatim), so nothing that could change rendering is touched. Prettier-grade inline
  whitespace reflow is a planned follow-up.

### 🧩 Compiler — opt-in comment preservation
- `parseTemplate(src, { comments: true })` now preserves `<!-- … -->` as `CommentNode`s instead of
  dropping them. It's **off by default**, so codegen and `weave check` are byte-for-byte unchanged; the
  Prettier plugin is the sole consumer, and it's what lets the formatter round-trip comments losslessly.

## 1.2.0 — 2026-07-06

### ✨ Feature — extend a component by *patching* its template
- **A component extension can now patch its base's template instead of overriding it.** Declare
  `export const patch` — a static array of ops — and skip writing your own template; the loader
  resolves the (local) base template, applies the ops, and compiles the result:
  ```ts
  // my-list.ts
  import List from './list';
  export const extend = List;
  export const patch = [
    { op: 'attr',    sel: '.weave-list__row', attr: 'on:dblclick={{ () => onRowDblClick(item) }}' },
    { op: 'prepend', sel: '[role]',           html: '<div class="count">{{ totalCount() }} total</div>' },
  ];
  export function setup(props, base) {
    return { ...base, totalCount: () => base.items().length, onRowDblClick: (i) => props.onOpen?.(i.value) };
  }
  ```
  Ops: `attr` / `removeAttr`, `prepend` / `append`, `before` / `after`, `replace`, `remove`, `wrap`.
  Selectors match by tag, `.class`, `[attr]`, or `[attr=value]`; a selector that matches nothing is a
  **loud build error**. Inserted markup and added attributes are ordinary Weave template text (`{{ }}`,
  `on:`, `use:`, `@if`/`@for`, nested components all work).
- **It's build-time, so it's correct for reactive content** — a patch on a `@for` row applies to every
  row, including ones added later (a runtime DOM patch would miss them). The extension compiles with the
  **base's style hash**, so the base's **scoped CSS still applies**.
- **Two constraints:** the base must be a **local** component (a published package ships no raw template
  — patch a local base, or use full override), and an extension uses **either** patches **or** a
  full-override template, never both.
- **Known limitation:** patch markup isn't type-checked by `weave check` yet (a typo in a patched
  expression surfaces at build/runtime, not in the editor). Full-override (`#1`) extensions are fully
  checked. See [Extending a component](https://weaveframework.dev/learn/components).
- This completes [RFC 0008](rfcs/0008-component-extension.md) (both modes: `#1` full override from 1.1.0,
  `#3` patches here).

## 1.1.0 — 2026-07-06

**Weave's first minor since 1.0** — new, backward-compatible surface (per [VERSIONING.md](VERSIONING.md)):
nothing you already wrote changes.

### ✨ Feature — extend a component without forking it
- **A component can now `extend` another** — it reuses the base's entire `setup` context and behaviour, then
  overrides or adds on top, with its own template as a full override. Authored as an ordinary component file:
  ```ts
  // my-list.ts
  import List from '@weave-framework/ui/list';
  import { computed } from '@weave-framework/runtime';

  export const extend = List;                          // this component extends <List>
  export function setup(props, base) {                 // base = List's setup context
    return { ...base, totalCount: computed(() => base.items().length) }; // reuse + add / override
  }
  ```
  The extension's template reads base-provided names (`listClass`, `items`, …) **and** the ones it adds, all
  from one merged context. Extensions **compose** — an already-extended component can be extended again. To
  reshape data the base's *internals* read (not just what the template sees), an optional `extendProps(props)`
  runs **before** the base setup. See [Extending a component](https://weaveframework.dev/learn/components).
- This is [RFC 0008](rfcs/0008-component-extension.md) **mode #1** (full template override). Declarative
  *patches* against the base template — add just an attribute or a node without rewriting the whole template —
  are a planned follow-up.

## 1.0.15 — 2026-07-06

### ✨ Feature — `use:` actions on component tags
- **A `use:` action now works on a component tag, not just a DOM element** — Weave forwards it to
  the component's single **root element**, with the identical lifecycle it has on an element (runs
  at mount, supports a returned cleanup or `{ update, destroy }`, and re-runs `update` when the
  argument changes; multiple `use:` on one component all run, in order):
  ```html
  <Button use:menu={{ accountMenu }}>Account ▾</Button>   <!-- action attaches to the root <button> -->
  <a use:menu={{ accountMenu }}>Account (footer)</a>       <!-- same menu, native trigger -->
  ```
  This lets a `@weave-framework/ui` `<Button>` (or any single-root component) be a menu/tooltip
  trigger, and preserves the "define once, trigger from many places" pattern across a mix of
  components and native elements. The action's `aria-*` and listeners land on the component's root
  element (e.g. `aria-haspopup`/`aria-expanded` on the `<button>` inside `<Button>`). `weave check`
  type-checks the action as `(Element, arg)` on components too.
- **Single-root constraint, fail-loud.** A component that renders a fragment (multiple top-level
  nodes), a text/comment root, or nothing is a clear error — *"use: on `<Account>`: actions attach
  to a single root element, but `<Account>` renders 3 nodes."* — never a silent mis-attach.
- Component **props**, `on:` events, and element-level `use:` are unchanged — no behaviour change
  for existing code. (`transition:`/`in:`/`out:` and `ref`/`bind:this` on components are not yet
  supported — a natural follow-up on the same forwarding mechanism.)

### 📋 Docs
- Accepted **RFC 0008 — component extension (`extendComponent`)**: a future primitive to subclass
  any component (reuse its `setup` + template, override/add on both) without forking. Design record
  only — not implemented yet.

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
