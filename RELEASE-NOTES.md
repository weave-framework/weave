# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

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
