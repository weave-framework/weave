# Weave — changelog

> **Versioning discipline (set 2026-07-02):** every commit bumps the framework **patch**
> version by 1. So the version = `0.2.0` (last npm release) **+ the number of commits since
> that release**. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The
> VS Code extension (`editor/vscode`) is versioned independently. **This version is exactly
> what is published to npm** — bump it in the same commit as the change, and record notable
> releases here. Publishing itself is a separate, explicit step (the `/publish` skill /
> `pnpm publish:packages`) — pushing code does **not** publish to npm. (The scheme started at
> `0.2.0`; the line crossed `1.0.0` on 2026-07-05 when the public API was frozen.)

## 1.0.15 — 2026-07-06

**Feature (compiler, check) — `use:` actions on component tags.** `use:action={{ arg }}` on a `<Component>` now
forwards to the component's single **root DOM element** through the same `applyAction` path elements use — identical
lifecycle (mount timing, returned cleanup or `{ update, destroy }`, `update(arg)` on change, multiple in order). The
compiler no longer rejects `use:` on a component tag; the mounted node is resolved to its root via a new `@internal`
`componentRoot(node, tag)` guard that throws a clear single-root error for a fragment/text/empty root ("use: on
`<Tag>`: actions attach to a single root element, but `<Tag>` renders N nodes.") — never a silent mis-attach.
`@weave-framework/check` already type-checked component directives as `(Element, arg)`; a parity test pins it. Props,
`on:` events, and element `use:` are unchanged. Docs updated (learn/templates + components, reference/template-syntax).

**Docs (rfc) — RFC 0008 accepted.** `extendComponent` — a future primitive to subclass any component (reuse its
`setup` + template, override/add on both sides) without forking. Design record only; not implemented.

## 1.0.12 — 2026-07-05

**Feature (cli) — `weave dev` proxy (`dev.proxy`).** A Vite/Angular/Next-style dev proxy so an app's API calls stay
same-origin in dev (no CORS; `HttpOnly` cookie auth works): `dev: { proxy: { '/api': 'http://localhost:5201' } }`
(shorthand) or the full `{ target, changeOrigin, rewrite }` form. A request is proxied when its path equals a key or
starts with `key + '/'` (`/api` matches `/api`/`/api/x`, not `/apiary`; first key wins), checked before the dev
server's own routes. Method/headers/body/query stream to the backend and the response pipes back unchanged, so
`Cookie`/`Set-Cookie` pass both ways; `changeOrigin` (default `true`) sets the forwarded `Host`; `rewrite` rewrites
the path only (query preserved); an unreachable backend → `502`, no crash. Dev-only, zero new deps (Node
`http`/`https`). Pinned by a new `verify:dev-proxy` gate (boots the real dev server + a throwaway backend; 5 checks
fail without the proxy).

## 1.0.10 — 2026-07-05

**Fix (ui) — `@weave-framework/ui` dist now ships a real `export default`, so components are consumable in a real
app.** The ui build was plain `tsc`, which shipped components UNCOMPILED (`export const template` /
`export function setup`, no `render`, no default export), so the documented
`import Button from '@weave-framework/ui/button'` failed a real consumer's `weave build` (*"No matching export for
default"*) and `weave check` (*TS1192*) — masked in the monorepo, where dev exports resolve to `src` and the loader
compiles on the fly. The ui build now compiles each component at build time through the loader's own
`compileComponent` (`tools/build-ui-components.mjs` → staged tree → `tsconfig.compiled.json`), emitting
`export default defineComponent(render, setup)` + a props-typed `.d.ts` default; `weave check` gained
`esModuleInterop` + `resolveJsonModule`. New gate `verify:ui-consume` proves consumption against the built dist for
all 29 components (fails on the old output — DoD-proven).

**Infrastructure — docs deploy moved from GitHub Pages to Cloudflare Workers** (`docs/wrangler.toml` +
`.github/workflows/docs.yml`). The Pages `deploy` step had begun intermittently returning a terminal *"Deployment
failed, try again later."* (build always passed); the docs now deploy to the same reliable Cloudflare static-assets
path as the flagship demo, still `[publish]`-gated. No framework change.

## 1.0.0 — 2026-07-05

**🏆 1.0 — the public API is frozen and stable.** The `0.2.108→1.0.0` arc (see `RELEASE-NOTES.md` for the
highlights) shipped Phase C (transition callbacks, reactive `@await`, DevTools panel + trigger-trace + component
tree, Forms v2 `dirty()`, Router v2), all Tier-2 template features (`<Teleport>`/`<Dynamic>`/`<KeepAlive>`,
reactive `style:`/`use:`), schema-driven forms, and two new packages — `@weave-framework/mcp` (MCP server) and
`@weave-framework/nx` (Nx plugin). The freeze (RFC 0005) `@internal`-tagged the compiler-emitted `runtime/dom`
helpers and made `VERSIONING.md`'s stability promise binding. All 14 packages went live on npm at `1.0.0`;
`1.0.1→1.0.5` followed with the README 1.0 hero, the `create-weave` template version pin, and three scaffolder
hotfixes (nx exports / nx generators / scaffolded-starter type error).

## 0.2.120 — 2026-07-04

**Fix (compiler + runtime) — SVG child elements in a nested fragment now get the SVG namespace.** An SVG-only
element (`<path>`, `<g>`, `<circle>`, `<rect>`, …) that is the root of a *separately-compiled* fragment — an
`@if` / `@for` / `@key` body, or a component/slot root — was parsed at the top level of a plain `<template>`, where
the HTML parser (having no `<svg>` ancestor to enter foreign content) created an inert `HTMLUnknownElement` in the
XHTML namespace: it appeared in the DOM but the browser never painted it. This is why a `@for`-driven SVG chart
(e.g. bars/paths bound to data) silently failed and had to be worked around with `<div>`s. The compiler now detects
a fragment rooted at an SVG-only tag and emits a namespace-aware `templateSvg()` runtime helper (parses inside a
throw-away `<svg>` wrapper, then lifts the children out) so those nodes are real SVG elements. `<svg>` itself is
unaffected (the HTML parser handles it correctly), and an SVG child in the *same* template already worked. Pinned by
five browser tests (`packages/compiler/test/svg.browser.ts`), three of which fail on revert.

## 0.2.108 — 2026-07-04

**Docs — new Examples section (six complete, runnable apps built with nothing but Weave).** A new top-level
`Examples` area (`/examples`) sits alongside Learn / Reference / UI, each page an end-to-end mini-app with the live
demo running on the page and its full `app.html` / `app.ts` / `app.scss` source beneath it. **Todo list** (signals,
`computed`, `store`, `localStorage` via an `effect`, keyed `@for`), **Data dashboard** (a `filtered → sorted →
paginated` pipeline owning the `Table` with `clientSort` off, custom `cell` renderers, live KPI `Card`s),
**Settings panel** (every form control bound one way, a live `Tabs` preview via factory content + `effect`,
`snackbar()`), **Sign-up wizard** (`@weave-framework/forms` `field`/`validators` wired to a linear `Stepper`'s
per-step `completed`, the idiomatic `control` binding on Input/Select/Checkbox, a Finish guard), and **Kanban board**
(the CDK `dropList` + `moveItemInArray` for drag-to-reorder, arrow buttons for lane moves). Each demo dogfoods the
real `@weave-framework/ui` components and was live-verified. No framework code changed.

## 0.2.87 — 2026-07-03

**Fix — composed child components resolve when nested inside `@if`/`@for` and documented as an import example
(`@weave-framework/cli`).** `<Table selectable>` silently blanked the whole render: its selection column composes the
real `<Checkbox>` (inside `@if`/`@for` blocks), but the child-import auto-resolver in the esbuild loader skipped
wiring it, so the compiled module referenced a bare `Checkbox` and threw a swallowed `ReferenceError`. Root cause was
in `importsBinding` — it scanned the component's **whole script including comments**, so Table's JSDoc usage example
(`import Checkbox from '@weave-framework/ui/checkbox'`) was mistaken for a real import and the resolver assumed the
child was already provided. It now scans a **comment-stripped** copy of the script (a small tokenizer that preserves
string/template literals so a `//` inside a string is not treated as a comment), so a documented import example no
longer suppresses auto-resolution. The compiler already collected nested PascalCase children correctly; an audit of
every UI component confirmed Table→Checkbox was the only one affected. Pinned by a failing-first end-to-end test
(`tools/verify-ui-compose.mjs`) that builds `<Table selectable>` through the real consumer loader and asserts the
composed `<Checkbox>` selection column mounts. The docs `/ui/table` page's Selection section is now a live demo.

## 0.2.61 — 2026-07-03

**U6 a11y audit — cross-cutting pass (reduced motion + RTL, `@weave-framework/ui`).** Completes the U6 accessibility
audit. **Reduced motion:** a new `reduced-motion()` mixin (included automatically by `all-styles()`) emits one
`@media (prefers-reduced-motion: reduce)` block, scoped to `weave-*` classes, that collapses every transition and
animation the library owns — including the previously-unguarded infinite Progress-Bar and Progress-Spinner loops — to
an instant duration, while keeping animation end-states intact. It never touches the consumer's own markup, and is
exposed standalone for per-component compiles. **RTL:** the cheap, direction-safe spacing swaps are now logical
(`margin-inline-*` on Chips/Paginator/Snackbar/Stepper); the deeper RTL work (bidi-aware keyboard arrows, fill/sticky
positioning) is a scoped follow-on. With this, all 37 styled components have been audited across roles/states,
keyboard, focus, reduced-motion, and RTL, with every fix pinned by a test.

## 0.2.60 — 2026-07-03

**U6 a11y audit — Batch D (power-user, `@weave-framework/ui`).** Audited Menubar, Popover-edit, and the Table
column-resize grip. One genuine fix, pinned by a failing-first test: the Table's `role="separator"` resize grip now
exposes **`aria-valuenow`** (the current column width, reactive as you resize) and **`aria-valuemin`** (the
min-width clamp) — the WAI-ARIA window-splitter values it was missing (`aria-valuemax` is intentionally omitted since
a column has no hard maximum). Menubar and Popover-edit audited fully conformant (roles/states, keyboard, focus).
Reduced-motion and RTL (arrow/drag direction) findings are batched into the centralized cross-cutting pass.

## 0.2.59 — 2026-07-03

**U6 a11y audit — Batch C (complex/data, `@weave-framework/ui`).** Audited the 10 complex components (Tabs, Sidenav,
Expansion, Stepper, Slider, Paginator, Table, Tree, Datepicker, Timepicker). Three genuine ARIA fixes, each pinned by
a failing-first test: **`<Datepicker>`** now exposes `aria-controls` from its combobox trigger to the calendar panel
(set on open, cleared on close), matching Select/Autocomplete; **`<Timepicker>`** spinbutton columns now carry the
APG-required `aria-valuemin`/`aria-valuemax` (hour 0–23 or 1–12 by 12/24h, minute 0–59); **`<Sidenav>`** declares
`aria-modal="true"` on the over-mode drawer while open (it already trapped focus and closed on Esc). Everything else
audited conformant on roles/states, keyboard, and focus; reduced-motion and RTL findings are batched into the
upcoming centralized cross-cutting pass. No behaviour change beyond the added ARIA.

## 0.2.58 — 2026-07-03

**U6 a11y audit — Batch B (overlay, `@weave-framework/ui`).** Audited the 8 overlay components (Tooltip, Menu,
Context-Menu, Dialog, Bottom-Sheet, Snackbar, Select, Autocomplete). The focus machinery is sound — modal focus-trap
activates after attach and restores focus on close; non-modal surfaces don't steal focus. One genuine fix:
**`<Autocomplete>`** used to set `aria-controls` once and leave it pointing at its (detached) listbox after close;
it now sets `aria-controls` on open and removes it on close, matching `<Select>` (pinned by a failing-first test).
Reduced-motion and one RTL (Snackbar `start/end` positioning) finding are batched into the upcoming centralized
cross-cutting pass; modal background `inert`/`aria-hidden` is logged as a scoped follow-on (the components are
already `aria-modal`-conformant). No other behaviour change.

## 0.2.57 — 2026-07-03

**U6 a11y audit — Batch A (foundational, `@weave-framework/ui`).** Audited the 17 foundational components (Button,
Button-Toggle, Icon, Badge, Card, Toolbar, List, Grid-List, Progress-Bar/Spinner, Checkbox, Radio, Slide-Toggle,
Form-Field, Input, Chips, Ripple) across roles/states, keyboard, and focus management: **all conformant** — no
behavioural defects found (several speculative findings were verified against the source and rejected). Added a
regression test pinning that `<ButtonToggle>`'s `aria-checked` tracks its bound value signal reactively after mount.
The only genuine issues are reduced-motion (unguarded CSS animations/transitions) and a few RTL physical-property
sites; both are batched into the upcoming centralized cross-cutting pass rather than fixed per-component. No
behaviour change ships in this version.

## 0.2.56 — 2026-07-03

**U6 a11y audit — start (`@weave-framework/ui`).** First unit of the structural accessibility audit (see
`UI-PLAN-U6.md` / `UI-A11Y-AUDIT.md`): the pre-identified **M9 — Select** finding. The `<Select>` combobox trigger
now exposes **`aria-controls`** pointing at its listbox (the listbox gained a stable `id`; the attribute is set on
open and removed on close, since the popup is detached while closed), and **Space** now selects/toggles the active
option in the open listbox exactly like Enter (WAI-ARIA APG listbox behaviour — previously Space only worked when no
option was active). Two failing-first tests pin both. No visual/token change. The U6 scope is **structural a11y only**
(roles/states, keyboard, focus, reduced-motion, RTL); contrast is consumer-owned and intentionally out of scope.

## 0.2.54 — 2026-07-03

**Security hardening (CodeQL code-scanning).** Fixed the flagged findings on the published packages, no API or
behaviour change: the `weave dev` static-file handler now **rejects path traversal** (a requested asset that
resolves outside `servedir` returns 403); the router's `basename` normalizer and the compiler's
`template`/`styles` extractor drop **polynomial-ReDoS regex shapes** (non-regex trailing-slash trim; the optional
type-annotation match is bounded to a single line); and the `gen-lucide-icons` build tool strips HTML comments to
a **fixpoint**. The remaining CodeQL findings (compiler codegen constructing code from the developer's own
compile-time source; `<Icon>` markup that is always run through `sanitizeSvg` before `innerHTML`) were reviewed as
false positives and dismissed.

## 0.2.53 — 2026-07-03 (first CI npm release since 0.2.0)

Release automation: a `[publish]`-marked commit → GitHub Actions publishes all `@weave-framework/*` + `create-weave`
to npm (provenance) and cuts a GitHub Release from `RELEASE-NOTES.md`. See `RELEASE-NOTES.md` for the highlights
shipped in this release.

## 0.2.52 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**polish + version sync**. Two low-risk correctness fixes
(each with a test that fails without it): **numeric `bind:value`** compares with `Object.is`, not `!==`, so a
NaN model value no longer always clobbers a mid-edit input (`NaN !== NaN` was always true); **`validators.pattern`**
clones a `g`/`y` regex without those flags, so `.test()` is no longer stateful across calls (it alternated as
`lastIndex` advanced). Also **synced the private root `package.json` to the lockstep version** (was `0.2.32`).
Deferred (riskier behaviour changes, tracked for a dedicated pass): custom-element disconnect-on-move grace,
`connectedPosition` listener cleanup between detach/attach, `dropList` unconditional `preventDefault`, ParseError
line:col, first-memo `equals(undefined,…)`. **962 tests green. Phase A complete.**

## 0.2.51 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Icon SVG sanitization (security)**. **M5** — `<Icon>` now
sanitizes any SVG before it reaches `innerHTML` (both the `svg`/registry markup and a fetched `src`): a zero-dep
`sanitizeSvg` parses it as `image/svg+xml` (nothing executes on parse) and strips `<script>`/`<foreignObject>`,
every `on*` event-handler attribute, and `javascript:` URLs — closing a `<svg onload=…>` execution vector. Also,
`<w:element this="…">` now refuses to build a `<script>` element (a dynamic tag is attacker-influenceable and would
execute). Both have tests that fail without them. **961 tests green.**

## 0.2.50 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**reactivity performance**. **M1** — block/component
construction is now wrapped in `untrack`: `ifBlock`'s branch, `eachBlock`'s `renderRow`/`empty`, and every
`defineComponent` instance, so a signal read *synchronously* during render no longer subscribes the enclosing
block/effect (their own bindings self-subscribe) — an unrelated change won't re-run a whole `@for` reconcile or
re-instantiate a component. **M2** — `eachBlock` wraps its per-row positional writes (`item`/`index`/`count`) in a
single `batch`, so a binding that reads more than one recomputes once per reconcile instead of up to three times
per row. Both have tests that fail without them. **959 tests green.**

## 0.2.49 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**compiler rewrite robustness**. **H4** — the expression
rewriter now (a) resolves bindings inside a template literal's `${ … }` (so `` {{ `Hi ${name}` }} `` becomes
`` `Hi ${ctx.name}` `` instead of leaving `name` a bare global — spliced in WITH source-map segments), and
(b) expands object shorthand, so `{{ { name } }}` emits `{ name: ctx.name }` instead of the invalid `{ ctx.name }`;
`freeIdentifiers` scans `${ … }` too, so auto-scope infers those names. **M4** — `inferCtxNames`' `declared` set is
now **per-scope, not global**: a `@for` item / `@let` / `@if (… as x)` / await-alias / snippet-param name is
subtracted only within its own block, so the same name used as component data elsewhere is still inferred as ctx
(snippet names stay template-wide via a pre-pass). Both have tests that fail without them. **957 tests green.**

## 0.2.48 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Select reactivity + parser strings**. **H3** — `Select` no
longer builds its option listbox once and caches it; a reactive effect (re)renders the open panel's options from
the current `props.options`, so async-loaded or edited options reflect live and every re-open renders fresh (mirrors
`Autocomplete`). **M3** — text interpolation now uses the same brace-balanced, string-aware scan as attribute
`{{ }}`, so a literal `}}` inside a string (`{{ fn("}}") }}`) or an inner object literal no longer cuts the
expression short at a naive `indexOf('}}')`. Both fixes have tests that fail without them. **952 tests green.**

## 0.2.47 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**reactive-core hardening**. Two verified core fixes,
each with a test that fails without it: **H1** — `computed()` now registers an owner-disposer, so a memo reading a
long-lived signal (router / i18n / store / `@let`) is detached (`unlink` + cleanups) on unmount instead of leaking
its subscription (and closure) forever; reads after disposal recompute and re-link (Solid semantics). **H2** — a
memo that throws is now left `DIRTY` instead of silently `CLEAN`, so the next read recomputes (and re-throws, or
succeeds once fixed) rather than returning a stale value — restoring fail-loud. Investigated **M8** (runaway-loop
guard): not reachable — `markDirty`'s DIRTY-guard + eager synchronous flush already terminate mutual/self cycles;
added a loop-safety regression test, no hot-path guard. `packages/runtime/src/reactive.ts`. **949 tests green.**

## 0.2.46 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Session wrap-up (docs).** No code change — added a cross-cutting **UI Library (U0–U5)** section to `NOTES.md`
(the arc + the durable decisions/gotchas; per-milestone detail stays in `UI-PLAN-U<n>.md`), refreshed HANDOFF +
the auto-memory. U4 + U5 complete; next is U6. Not published, not mirrored.

## 0.2.45 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Popover-edit** — inline cell editing (U5 §5.3). **This completes U5.**

### UI (`@weave-framework/ui`) — `./popover-edit`
- **`popoverEdit(host, config)`** (a `use:popoverEdit` action) — click / Enter / F2 opens a **non-modal** CDK-overlay
  editor (the U3 overlay-republic chrome) seeded from `config.value()`. **Enter and click-away commit**
  (`onCommit`), **Esc cancels**; focus moves into the editor and back to the host. Default editor = a text field
  sharing Input's `field-underline` (RULE #1); a custom `editor` factory (`{ element, read, focusTarget? }`)
  supplies a Select/date/etc. `aria-haspopup=dialog`. **Deferred:** Table `column.editable` wiring, multi-cell edit.
- Gates: **946 tests (+8); verify:ui-sass 287 (+1);** typecheck + `eslint .` clean.

> **✅ U5 (Experimental) COMPLETE** — Table column-resize · Menubar · Popover-edit. (Dropped the standalone
> "selection" widget — the U4 CDK `SelectionModel` already closes it.) Next: U6 (harnesses + docs + gallery).

## 0.2.44 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Menubar** — an app menu bar (WAI-ARIA menubar, U5 §5.2).

### UI (`@weave-framework/ui`) — `./menubar`
- **`<Menubar menus onSelect>`** — a `role=menubar` of top `<button role=menuitem>`s; each opens the **shared Menu
  panel** (`menu-core.openMenuPanel`, so the panel chrome / roving / typeahead / Esc / backdrop are reused — RULE
  #1, no new dropdown). Roving Left/Right/Home/End + typeahead; ArrowDown/Enter/Space open (focused on the first
  item); click toggles; **Left/Right switch to the neighbour menu while one is open**; Esc closes + returns focus.
  `onDispose` tears down any open dropdown. The dropdown reuses `.weave-menu`.
- **Deferred:** nested submenus.
- Gates: **938 tests (+9); verify:ui-sass 286 (+1);** typecheck + `eslint .` clean.

## 0.2.43 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Table column-resize** (U5 §5.1) + a `datepicker.browser.ts` typecheck fix.

### UI (`@weave-framework/ui`) — `./table`
- **Column resize** — a per-column `resizable` (or table-level `resizableColumns`) puts a `role=separator` grip on
  each resizable `<th>`. **Pointer** drag via the CDK `draggable` (axis x) sets a live width (clamped to `minWidth`,
  default 48); **keyboard** Arrow Left/Right resize by 16px. Widths ride an internal signal (a controlled
  `columnWidths` prop wins) so `widthCss` + the sticky-offset maths recompute reactively. Emits
  `onColumnResize({ key, width })`; `[data-resizing]` marks the table during a drag. **Deferred:** double-click
  auto-fit, column reorder.
- **Fix:** `datepicker.browser.ts` had two test-only type errors (a `void` arrow returning a boolean; a 3-arg
  `matchRe`) that slipped into `0.2.42` (committed after eslint but before `tsc`). Restored a clean typecheck.
- Gates: **929 tests (+3); verify:ui-sass 285 (+1);** typecheck + `eslint .` clean.

## 0.2.42 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Datepicker text-entry** (opt-in `editable`) + the **U5 sub-plan** is written.

### UI (`@weave-framework/ui`) — `./datepicker`
- **`<Datepicker editable>`** — swaps the design's button trigger for a typeable **input-as-combobox** (role
  moves to the input; the wrapper drops its role). Typing + Enter/blur **parses via the CDK `adapter.parse`** →
  commits (clamped + normalised to the display format), OR flags **`aria-invalid`** + `--invalid` and keeps the
  text. The calendar icon becomes a toggle button; ArrowDown opens the calendar; clear × empties. Default
  (non-editable, the design's button) is unchanged. New `__input` + `__icon-button` styles.
- Gates: **926 tests (+6); verify:ui-sass 284 (+1);** typecheck + `eslint .` clean.

### Plan
- **`UI-PLAN-U5.md`** written (Experimental milestone): Table column-resize · Menubar · Popover-edit.

## 0.2.41 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree reorder** + a `dropList` keyboard opt-out.

### UI (`@weave-framework/ui`) — `./tree`, `./cdk`
- **`<Tree reorderable onReorder>`** — a per-node `__drag-handle` via the CDK **`dropList`** (`handle` selector, so
  node clicks still select/expand). `onReorder({ previousIndex, currentIndex })` — indices over the **visible** node
  order (`visible()[i].node`); the consumer applies it. (Hierarchy-aware reparenting is a deferred refinement.)
- **CDK `dropList` — new `keyboard?: boolean`** (default true). List + Tree pass `keyboard: false` so the
  listbox/tree keeps Space/Arrows for selection + roving (dropList's Space-to-lift would otherwise hijack them).
- Gates: **921 tests (+4); verify:ui-sass 283 (+1);** typecheck + `eslint .` clean.

## 0.2.40 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**List reorder** — drag-to-reorder rows (via the CDK `dropList`).

### UI (`@weave-framework/ui`) — `./list`
- **`<List reorderable onReorder>`** — a per-row `__drag-handle` (⠿ grip) wired via the CDK **`dropList`** with a
  `handle` selector, so a row-body click still selects and only the handle starts a drag. Emits
  `onReorder({ previousIndex, currentIndex })`; the List is controlled (the consumer reorders `items`). New handle
  tokens + `touch-action: none`.
- Gates: **917 tests (+3); verify:ui-sass 282 (+1);** typecheck + `eslint .` clean.

## 0.2.39 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Bottom Sheet drag-to-dismiss** — the U3-deferred gesture, now unblocked by the CDK Drag & Drop (§4.11).

### UI (`@weave-framework/ui`) — `./bottom-sheet`
- **`openBottomSheet({ dragToDismiss })`** (default true) — a top `__handle` grabber wired via the CDK
  **`draggable`** (axis `y`): dragging the handle down translates the sheet; releasing past `max(80, 0.3·height)`
  closes it, else it snaps back. New handle tokens + `touch-action: none`.
- Gates: **914 tests (+3); verify:ui-sass 281 (+1);** typecheck + `eslint .` clean.

## 0.2.38 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Timepicker** — a time field + spinner popover (U4 §4.14, Phase D). **This completes U4.**

### UI (`@weave-framework/ui`) — `./timepicker`
- **`<Timepicker>`** — the design's spinner-column variant: a Select-style trigger field (shared `field-underline`
  chrome) + clock icon opens a CDK-overlay panel of **hour ▲/▼ : minute ▲/▼** `role=spinbutton` columns + an
  **AM/PM toggle** (12-hour locales). 12h vs 24h is derived from the locale (`use24` override); `step` (minutes,
  default 5); `min`/`max` clamp the committed time.
- **Value** — a neutral `{ hours, minutes }` (24-hour internal). Binding follows the Weave form convention
  (`value`/`onChange` OR a `control`; touched-on-close; `aria-invalid`).
- **Keyboard** — Arrow Up/Down per column (`aria-valuenow`/`-valuetext`), Esc close. **Deferred:** the interval-
  listbox alternative, text-entry parsing, seconds.
- Gates: **911 tests (+13); verify:ui-sass 280 (+5);** typecheck + `eslint .` clean.

> **✅ U4 (Complex / data) COMPLETE** — 14 units: Expansion · Tabs · Stepper · Slider · Paginator · Sidenav · CDK
> SelectionModel/DataSource · CDK Virtual Scroll · Table · Tree · CDK Drag&Drop · CDK Date-adapter · Datepicker ·
> Timepicker. Next: U5 (Experimental), then U6 (harnesses + docs + gallery).

## 0.2.37 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Datepicker** — a date field + calendar popover (U4 §4.13, Phase D).

### UI (`@weave-framework/ui`) — `./datepicker`
- **`<Datepicker>`** — a Select-style trigger field (shares Input's `field-underline` chrome; the design's field is
  a button trigger) with a calendar icon, opening a **CDK-overlay calendar** (non-modal — transparent backdrop +
  Esc). Calendar = a `role=grid` month view: ‹/› month nav, a locale weekday header (reordered by `firstDayOfWeek`),
  `role=gridcell` day buttons — **selected = accent fill + white, today = an inset accent ring**.
- **Keyboard:** Arrows (day), PageUp/Down (month), Shift+PageUp/Down (year), Home/End (week edges), Enter/Space
  (select), Esc (close + return focus). All date math via the CDK **Date adapter**; `min`/`max` + a `dateFilter`
  predicate disable cells.
- **Binding:** the Weave form convention — `value` (`Date | null`) + `onChange`, OR a `control` `Field<Date>`
  (touched-on-close, `aria-invalid`). Compose with `<FormField>` for label/hint/error.
- **Deferred (noted):** text-entry parsing (the `adapter.parse` is ready — a cheap follow-up), date-range,
  year-picker view.
- Gates: **898 tests (+12); verify:ui-sass 275 (+6);** typecheck + `eslint .` clean.

## 0.2.36 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**CDK Date adapter** — the zero-dep date model under the pickers (U4 §4.12, Phase D).

### UI (`@weave-framework/ui`) — `./cdk`
- **`createDateAdapter({ locale?, firstDayOfWeek? }) → DateAdapter`** — native `Date` + `Intl` only (rule #1, no
  date library). Neutral value type = a plain **local-midnight `Date`**.
- Arithmetic: create/clone/today; add days/months/years (**overflow-clamped** — Jan 31 + 1 month → Feb 28/29;
  DST-safe); start/end of month + days-in-month (leap-year correct, incl. 1900/2000); compare / isSameDay / clamp.
- `format` via `Intl.DateTimeFormat`; **`parse`** = ISO `yyyy-mm-dd` fast-path + the locale's numeric field order
  (from `formatToParts`), **rejecting overflow** (Feb 30 → null) + expanding 2-digit years.
- Calendar helpers: locale `firstDayOfWeek` (`Intl.Locale` weekInfo, override-able), `getDayOfWeekNames` /
  `getMonthNames` (JS order). **Deferred:** custom parse masks, non-Gregorian calendars.
- Gates: **886 tests (+13); verify:ui-sass 269 (unchanged — headless);** typecheck + `eslint .` clean.

## 0.2.35 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**CDK Drag & Drop** — the headless pointer-drag + reorder engine (U4 §4.11, Phase D).

### UI (`@weave-framework/ui`) — `./cdk`
- **`draggable(el, opts)`** — standalone free-drag via pointer capture: an `offset()` signal (constrainable to one
  `axis`), a `threshold` (click-vs-drag), a `handle`, and `onStart`/`onMove`/`onEnd`. The single-gesture case (the
  Bottom Sheet's drag-to-dismiss).
- **`dropList(container, opts)`** — a reorderable list: the **insertion index** = the count of non-dragged sibling
  midpoints the pointer has crossed; `dragging()`/`activeIndex()`/`overIndex()` signals; `onDrop({previousIndex,
  currentIndex})`. Full **keyboard DnD** (Space lift → Arrows move → Space drop, Escape cancel). Event delegation.
- **`moveItemInArray(array, from, to)`** — immutable reorder applier (clamps `to`).
- **Deferred (noted):** cross-list transfer (`connectedTo`), a drag-preview helper. Unblocks the U3 Bottom Sheet
  drag-dismiss + reorderable List/Table-row/Tree.
- Gates: **873 tests (+10); verify:ui-sass 269 (unchanged — headless);** typecheck + `eslint .` clean.

## 0.2.34 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree** — controlled `expanded` (follow-up to `0.2.33`).

### UI (`@weave-framework/ui`) — `./tree`
- **`<Tree expanded>`** — expansion is now **controlled** (`expanded?` is the source of truth) OR **uncontrolled**
  (`defaultExpanded`), the Tabs convention. When controlled, expand/collapse emit `onExpandedChange` **without
  self-mutating** — the owner applies the next set. Pinned by a guard test (`no self-open — the prop still says
  collapsed`). Added after review flagged that deferring it was wrong (cheap + the library's own binding
  convention). No CSS change.
- Gates: **863 tests (+1); verify:ui-sass 269 (unchanged);** typecheck + `eslint .` clean.

## 0.2.33 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

**Tree** — the WAI-ARIA `role=tree` hierarchy (U4 §4.10, Phase C).

### UI (`@weave-framework/ui`) — `./tree`
- **`<Tree>`** — a template-based hierarchical disclosure surface (keyed `@for` over the **visible flattened
  nodes**, arbitrary content via `@render`). **Two data models:** *nested* (a `children` accessor, `node.children`
  by default, recursed; descendants show only while expanded) or *flat* (pass `getLevel` → a DFS scan hides
  descendants of collapsed nodes). Both emit `aria-level`/`-setsize`/`-posinset`.
- **Expansion + selection** ride the CDK `SelectionModel` (expansion uncontrolled + `onExpandedChange`; selection
  optional `selectable` single/multiple + `onSelectionChange` + `compareWith`; selected node = accentSoft tint +
  2px accent left border, the List visual).
- **Keyboard** = CDK `listKeyManager` (vertical, typeahead) for Up/Down/Home/End + a single roving tab stop, plus
  **Right** (expand / step into first child) / **Left** (collapse / move to parent) / Enter-Space (activate).
- Indent = an inline `--weave-tree-depth` custom prop × the `indent` token (design: depth × 18px); rotating ▸
  disclosure marker (CSS `::before`). `./tree` subpath (JS + SCSS); `tree-overrides()` wired.
- **Deferred (noted):** checkbox nodes + parent/child cascade, drag-reorder (Phase D DnD), virtual body, controlled
  `expanded`.
- Gates: **862 tests (+13); verify:ui-sass 269 (+5);** typecheck (all 12 pkgs) + `eslint .` clean.

## 0.2.32 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Regression guard for the `0.2.31` double-fire fix. The existing suite passed the fix
*independently* of it (the Table test only survived via idempotent select; the isolated
Checkbox test never exercised the runtime forward loop) — so the fix was not actually pinned.

### Compiler (`@weave-framework/compiler`) — `component.browser.ts`
- **`defineComponent does NOT forward a data-callback prop (no double-fire)`** — composes a
  child that consumes `onChange` via a setup binding fired by an inner `<input>`'s bubbling
  `change` (mirrors Checkbox). Asserts it fires **once**. Verified it **fails (calls=2)** when
  `defineComponent` is reverted to the old `/^on[A-Z]/` forward — a true guard.
- **`defineComponent forwards a real on:X event to the child root`** — asserts `$events`-marked
  events are still forwarded (guards the other direction — that the fix didn't break Button-style
  composition).

## 0.2.31 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Framework fix — composed-component event handlers no longer double-fire. This removes the
Table selection workaround (idempotent select + bool-or-Event normalisation) and is the
correct foundation for every future component that passes a data-callback prop to a child.

### Compiler (`@weave-framework/compiler`)
- A component tag now emits a hidden **`$events` marker** listing only its real `on:X`
  event-attr prop keys (e.g. `<Checkbox on:click … onChange={{…}}>` → `$events: ['onClick']`,
  `onChange` excluded). Data-callback props (`onChange`, `onInput`) are ordinary reactive
  getters, not events.

### Runtime (`@weave-framework/runtime`)
- `defineComponent` now auto-forwards **only the `$events` keys** to the child root element
  (previously it forwarded any `/^on[A-Z]/` function prop). A data-callback consumed *inside*
  the child (e.g. Checkbox's `onChange`, fired by its own `on:change`) is no longer ALSO
  attached as a bubbled DOM listener — so it fires exactly once instead of twice. `on:X`
  forwarding (Button's click, etc.) and consume-by-name are both unchanged.

### UI (`@weave-framework/ui`)
- **Table selection simplified** now that the double-fire is gone: `toggleSelect(row, checked)`
  + `onSelectAll(checked)` take a plain boolean; the `checkedFrom` bool-or-Event normaliser and
  the idempotent-select workaround are removed.

## 0.2.30 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Table — RULE #1 correctness: the selection checkboxes now COMPOSE the real Checkbox
component (not a restyled native input), which forced a rewrite of the Table to a
template-based component.

### UI (`@weave-framework/ui`)
- **Table is now a template-based component** (was built imperatively). The rows are a keyed
  `@for` over the sorted data, cells mount via `@render`, and — crucially — the selection
  column **composes the real `<Checkbox>`** (full behaviour + one checkbox visual in the
  library), exactly like Paginator composes `<Button>`. The earlier native-`<input>` +
  `.weave-table__checkbox` restyle (a RULE #1 violation the user caught) is gone, along with
  its tokens. A selectable Table therefore pulls in `@weave-framework/ui/checkbox` styles.
- **Gotchas fixed along the way:**
  - Nested `@for` (rows × columns) can't reference the outer row — the compiler names every
    loop item `_row`, so the inner loop shadows it. Cells are pre-resolved per row into a
    `cellsFor(row)` array so the inner `@for` only touches its own item.
  - Rows are keyed by **object identity** (or `trackBy`), not index, so a sort reorders the
    existing DOM by identity instead of stranding one-shot `@render` cell content.
  - The composed `<Checkbox>`'s `onChange` fires **twice** (once as its data callback, once
    via the runtime's event auto-forward to the child root). The Table's handlers read the
    checkbox's actual checked state and use idempotent `select`/`deselect`/`setSelection` —
    so the row lands in the right state regardless. `aria-expanded` is emitted as a string.
- 13 browser tests (all green); `verify:ui-sass` 262; full typecheck + eslint clean.
  Live-verified: select/deselect a row, select-all + indeterminate + uncheck, expand/collapse.

## 0.2.29 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Table follow-up — inner vertical scroll with a fixed header.

### UI (`@weave-framework/ui`)
- **`<Table maxHeight>`** — caps the body height so the `<tbody>` scrolls **vertically inside**
  the table while the sticky header stays pinned (previously the header only stuck to the page
  because the scroll box had `overflow-x` only). The scroll box is now `overflow: auto` (both
  axes), so a `max-height` gives an inner vertical scroll and a wide table an inner horizontal
  scroll — sticky header + sticky columns both pin to the scroll-box edges. Live-verified
  (body scrolls 200px, header delta 0; sticky Order column offset; live show/hide columns).

## 0.2.28 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C — the **Table**, the flagship data surface.

### UI (`@weave-framework/ui`)
- **New `<Table>` component** (`@weave-framework/ui/table`) — a real `<table>` (native
  `<thead>/<tbody>/<th scope=col>/<td>` semantics) driven by a **column-def + DataSource**
  API. Built imperatively in `setup()` (cells are arbitrary `Node`s and the body is reactive
  over data/sort/selection/expansion — text interpolation carries neither), styled by the
  Weave design (hairline rows, compact 34px, accent-as-a-mark).
- **Sort headers:** sortable `<th>` = a `<button>` cycling asc→desc→none (asc↔desc with
  `disableClear`), sets `aria-sort`, shows the accent arrow, single active column; emits
  `onSort` **and** convenience client-side sort for array/signal sources (a custom DataSource
  owns its own order).
- **Row selection** via the CDK `SelectionModel`: leading checkbox column, header
  select-all + indeterminate, `single`/`multiple`, `aria-selected` on the `<tr>` + accentSoft
  tint + 2px accent left border; `onSelectionChange` / bring-your-own model.
- **Beyond the base plan (user-requested):** **sticky columns** (`column.sticky: 'start'|'end'`,
  any column, computed offsets; the select/expand columns auto-stick), **show/hide columns**
  (`column.hidden`, reactive when `columns` is bound), and **expandable detail rows**
  (`expandable` + `detail(row)`, chevron toggle + full-width detail `<tr>`, expansion state in
  its own `SelectionModel`). Sticky header + hairline separators + tabular-nums numeric cells.
- **Virtual body:** plain-scroll in v1; the CDK `virtualScroll` hook is ready for the
  follow-on. `./table` subpath (JS + SCSS).
- 13 browser tests (structure, node cells, sort cycle + client-sort + `aria-sort`, selection +
  select-all + indeterminate + single, expandable, show/hide, sticky column, ArrayDataSource +
  reactive signal source, numeric); `verify:ui-sass` 262 (+9). Live-verified in the gallery.

## 0.2.27 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C — the **Virtual Scroll** headless engine.

### UI CDK (`@weave-framework/ui/cdk`)
- **`virtualScroll(options)`** (`cdk/virtual-scroll.ts`) — the rendered-window engine under
  large Table/Tree bodies + long lists. Given a viewport element, a fixed `itemSize` and a
  `total` (number or getter), it computes the buffered slice to render — `renderedRange()`
  `[start, end)`, `scrollOffset()` (top spacer), `endOffset()` (bottom spacer), `totalSize()`
  — all as signals; plus `scrollToIndex()`, `measure()`, `destroy()`. Fixed-size strategy
  first (autosize is a follow-on). Built on the U1 `onScroll` dispatcher + `resizeSignal`
  (ResizeObserver → viewport height); `renderedRange` is a `computed` with a start/end
  equality guard so it only notifies when the window actually changes (not every scroll pixel).
  Edge-cased: empty/short lists never produce negative ranges; the window clamps to `total`.
- 11 headless tests (window math at scroll 0/mid/end, buffer overscan + top clamp, empty +
  short lists, reactive total, sub-item-scroll stability, scrollToIndex clamp, ResizeObserver
  recompute).

## 0.2.26 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase C (start) — two headless CDK data primitives, built before Table/Tree.

### UI CDK (`@weave-framework/ui/cdk`)
- **`selectionModel<T>(options)`** (`cdk/selection-model.ts`) — the signal-native selection
  engine under Table rows / Tree nodes / List multi-select. `select`/`deselect`/`toggle`/
  `setSelection`/`clear`, `single` vs `multiple`, an optional `compareWith` (object copies
  match by key), reactive `selected()`/`count()`/`isEmpty()`/`isSelected()`, and an
  `onChange` delta stream (`{ added, removed }`) that only fires on a real change. Zero DOM.
- **`DataSource<T>` + `ArrayDataSource`** (`cdk/data-source.ts`) — the collection-viewer
  contract a Table/Tree consumes so paging/sorting/filtering/virtualization can be swapped
  without the component knowing: `connect(viewer?) → Computed<T[]>` (read-only signal) /
  `disconnect()`. `ArrayDataSource` wraps a static array **or** a signal (reactive updates
  propagate through `connect()`); `isDataSource()` guard. Signal-native, no RxJS.
- 15 headless tests (single/multi transitions, no-op guards, `compareWith` identity, delta
  payloads, reactivity; DataSource static + reactive-signal propagation + read-only view).

## 0.2.25 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

U4 Phase B — the **Sidenav** responsive layout shell.

### UI (`@weave-framework/ui`)
- **New `<Sidenav>` component** (`@weave-framework/ui/sidenav`) — a `__drawer` beside a
  `__content` with three modes: **`side`** (drawer in flow, pushes content), **`over`**
  (drawer floats over a dimming backdrop; a modal focus context — CDK focus-trap in, Esc +
  backdrop-click close), **`push`** (drawer floats + shifts content). **Responsive:** omit
  `mode` and it consumes the CDK `breakpointSignal` — below the Weave `Narrow` breakpoint
  (900px) it auto-switches to over + closed, above to side + open. This fulfils the off-canvas
  drawer deferred from the U2 Toolbar (a Toolbar hamburger toggles it).
- **Open state** follows the Weave convention: controlled `opened` (getter) + `onOpenedChange`,
  or uncontrolled `defaultOpened`; imperative `open()`/`close()`/`toggle()`/`opened()` exposed
  via the `api` ref callback (like Input's `onInputRef`). Drawer edge via `position: 'start' | 'end'`.
- **State rides root modifier classes** (`--side`/`--over`/`--push`, `--opened`, `--end`,
  `--backdrop`) — no per-element state class. The `over` backdrop **reuses the shared overlay
  scrim token** (`--weave-sidenav-backdrop: var(--weave-overlay-backdrop)`) so every scrim in
  the library reads identically. Fully tokenized SCSS (RULE #1). 12 browser tests
  (structure/modes/controlled/api/Esc/responsive/focus-trap); `verify:ui-sass` 253.

## 0.2.24 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

Completes the RULE #1 tokenization pass — the last per-component spacing/typography
literals now resolve from each component's own token schema (no hard-coded values left).

### UI (`@weave-framework/ui`)
- **Tokenized the remaining literals in 10 components** (chips, menu, dialog, bottom-sheet,
  card, tooltip, snackbar, list, expansion, autocomplete): `line-height` (1.3/1.4/1.5),
  `font-weight: 400` subtext weights, small `gap`/`padding-y` values, the chips × glyph
  size + edge nudge, and the menu divider height — each now a `var(--weave-<c>-…)` backed by
  a new key in the component's `_tokens.scss`. Structural constants (`0`, `100%`, `50%`,
  `line-height: 1` resets, 1px hairline borders, keyframe transforms) stay literal, matching
  the established convention. **Compiled CSS is byte-identical** (token value = former
  literal) — `verify:ui-sass` 245 unchanged, confirming no visual change.
- **✅ RULE #1 fully satisfied** across the UI library: every component composes the real
  child components and every SCSS value flows from a token schema.

## 0.2.23 — 2026-07-02 (unpublished; on `main`, ahead of the 0.2.0 npm release)

The U4 (complex/data) build **plus** a mid-milestone architecture correction — RULE #1:
UI components must **compose** already-built components, never re-create them.

### Framework (runtime/compiler)
- **`defineComponent` auto-forwards component-level `on:X` handlers to the rendered root
  element.** `<Button on:click={{…}}>` now just works — a component never re-declares events
  to be composable. Skips events the component consumes itself (a setup binding shadows it).

### UI — RULE #1 composition (no duplicates)
- Components now **compose** the real components instead of re-creating look-alikes:
  Stepper Back/Continue → `<Button>`; Paginator page/nav → `<Button>`, jump field →
  `<Input>`, page-size → `<Select>`; Autocomplete field → `<Input>`.
- Shared style helpers (single source) in `styles/_helpers.scss`: `field-underline`,
  `clear-button`, `checkmark` — used by Input/Select (and Autocomplete via Input) and
  Checkbox/Stepper. No duplicated field chrome or glyphs.
- `Button` gains `ariaCurrent`; `Input` gains `onInputRef` (composers add combobox ARIA) and
  `clear()` dispatches a real `input` event so composers react.
- Internal `src/internal/compose.ts` (`toComponent`) + the `_c` child-component map power
  composition in the library's own tests/gallery (a real `weave build` emits the same shape).

### UI — new U4 components (Phase A)
- **Expansion Panel** (accordion), **Tabs**, **Stepper**, **Slider**, **Paginator**.

### Gates
- 796 browser tests, `verify:ui-sass` 245, monorepo typecheck + `eslint .` — all green.

## 0.2.0 — 2026-06-30

First npm release: 10 `@weave-framework/*` packages + `create-weave`. Framework (runtime/
compiler/store/router/forms/i18n/data/cli), editor tooling, docs site, and U0–U3 of the UI
library. See `NOTES.md` / git history for detail.
