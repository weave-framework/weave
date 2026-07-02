# Weave — changelog

> **Versioning discipline (set 2026-07-02):** every commit bumps the framework **patch**
> version by 1. So the version = `0.2.0` (last npm release) **+ the number of commits since
> that release**. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The
> VS Code extension (`editor/vscode`) is versioned independently. **This version is exactly
> what is published to npm** — bump it in the same commit as the change, and record notable
> releases here. Publishing itself is a separate, explicit step (the `/publish` skill /
> `pnpm publish:packages`) — committing/pushing does **not** publish or mirror.

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
