# Weave — changelog

> **Versioning discipline (set 2026-07-02):** every commit bumps the framework **patch**
> version by 1. So the version = `0.2.0` (last npm release) **+ the number of commits since
> that release**. All framework packages move in **lockstep** (one version across
> `@weave-framework/*`); `workspace:*` deps resolve to the concrete version at publish. The
> VS Code extension (`editor/vscode`) is versioned independently. **This version is exactly
> what is published to npm** — bump it in the same commit as the change, and record notable
> releases here. Publishing itself is a separate, explicit step (the `/publish` skill /
> `pnpm publish:packages`) — committing/pushing does **not** publish or mirror.

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
