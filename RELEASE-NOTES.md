# Release notes

Human-readable highlights, one section per release — everything notable that landed since
the previous one. For the granular, per-version log see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

Reliability, correctness, and security improvements across the core.

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
