# Weave — changelog

> **Versioning discipline (set 2026-07-02):** every commit bumps the framework **patch**
> version by 1. So the version = `0.2.0` (last npm release) **+ the number of commits since
> that release**. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The
> VS Code extension (`editor/vscode`) is versioned independently. **This version is exactly
> what is published to npm** — bump it in the same commit as the change, and record notable
> releases here. Publishing itself is a separate, explicit step (the `/publish` skill /
> `pnpm publish:packages`) — committing/pushing does **not** publish or mirror.

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
