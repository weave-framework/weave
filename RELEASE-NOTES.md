# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

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
