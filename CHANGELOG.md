# Weave — changelog

> **Versioning discipline (set 2026-07-02):** every commit bumps the framework **patch**
> version by 1. So the version = `0.2.0` (last npm release) **+ the number of commits since
> that release**. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The
> VS Code extension (`editor/vscode`) is versioned independently. **This version is exactly
> what is published to npm** — bump it in the same commit as the change, and record notable
> releases here. Publishing itself is a separate, explicit step (the `/publish` skill /
> `pnpm publish:packages`) — committing/pushing does **not** publish or mirror.

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
