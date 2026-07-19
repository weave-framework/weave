# Versioning & stability

Weave's promise to the code you write is simple: *it won't change out from under you.*
This page says exactly what that means, and how versions are decided.

## What the promise covers

A stability promise is only meaningful if it's clear what it protects. Weave's **public
API** — the surface you're safe to build on — is:

- Every documented export of a `@weave-framework/*` package
- Documented component inputs (props) and their behavior
- The template syntax
- For UI components: the design-token / CSS-custom-property contract, and the documented
  ARIA/DOM structure you're expected to style and target

Anything **not** on that list — internal helpers, undocumented behavior, private fields,
implementation detail — is not part of the contract and may change at any time. This boundary
is deliberate and enforced: the public surface was audited before 1.0 ([RFC 0005](rfcs/0005-api-surface-audit.md)),
and the compiler-emitted runtime helpers your build imports (e.g. from `@weave-framework/runtime/dom`) are
tagged `@internal` and excluded from the API reference — they stay exported for generated code, but their
signatures are free to change and carry no stability promise.

## How a version is decided

Weave follows [Semantic Versioning](https://semver.org). One question decides a release:
*could a consumer who wrote code against the public API, and changed nothing, be affected?*

- **PATCH** (`x.y.Z`) — a backward-compatible bug fix. Behavior moves toward what was
  documented or intended; the API shape doesn't change.
- **MINOR** (`x.Y.0`) — new, backward-compatible surface: a new component, function,
  optional prop, or config option with a safe default. Old code is untouched. (Marking
  something **deprecated** is a minor change; *removing* it is not.)
- **MAJOR** (`X.0.0`) — a breaking change: existing consumer code could stop compiling,
  stop running, or behave differently without being changed. For example: removing or
  renaming a public export, an incompatible signature change, a changed default behavior,
  a UI token/DOM-contract change, or a type that's narrowed so previously-valid code no
  longer type-checks.

## One version, every package

Every `@weave-framework/*` package (and `create-weave`) shares a **single lockstep version**, released
together. If you see `1.6.0` on one, that's the version of all of them — so packages that are meant to work
together always do, and there's no compatibility matrix to reason about. A release publishes the whole set in
dependency order.

## How a release happens

Releases are cut from `main` by CI, not by hand: a commit whose message contains the marker `[publish]` triggers
the release workflow, which publishes every package to npm and creates a matching GitHub Release, with the notes
taken from that version's section of [RELEASE-NOTES.md](RELEASE-NOTES.md). The documentation site deploys under
the same gate, so the docs never get ahead of the packages they describe. Ordinary commits publish nothing.

## When a breaking change is genuinely needed

We won't pretend it can never happen — one day something may need to change at its root.
When it does, it won't blindside you:

- **Never by surprise** — it lands in a deliberate, clearly flagged release of its own,
  never slipped into a routine upgrade.
- **Deprecated first** — the old way keeps working through a deprecation window, with
  warnings pointing to the replacement, before anything is removed.
- **With a path forward** — clear migration notes, and a codemod wherever one is feasible.

A deprecated API keeps working until at least the next major release, and is only then
removed — so deprecations don't pile up forever, and nothing disappears without that
window to migrate.

## 1.0 and onward

**Weave is 1.0.** The public API surface above was audited and settled ([RFC 0005](rfcs/0005-api-surface-audit.md)),
and the promise is now in full force: **breaking changes land only in a major version, deprecated first.** The
`0.2.x` line shipped over a hundred releases without a breaking change to the code you write, so 1.0 formalises
a practice that was already in place rather than starting a new one. That line was short — days, not months —
so treat it as evidence of discipline, not of long-run maturity; the guarantees below are what you can hold us
to, and they are enforced by CI rather than by intent.

Pre-1.0 history is preserved in [CHANGELOG.md](CHANGELOG.md); from 1.0 on, the version number carries the
guarantee.
