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
implementation detail — is not part of the contract and may change at any time.

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

## When a breaking change is genuinely needed

We won't pretend it can never happen — one day something may need to change at its root.
When it does, it won't blindside you:

- **Never by surprise** — it lands in a deliberate, clearly flagged release of its own,
  never slipped into a routine upgrade.
- **Deprecated first** — the old way keeps working through a deprecation window, with
  warnings pointing to the replacement, before anything is removed.
- **With a path forward** — clear migration notes, and a codemod wherever one is feasible.

## Before 1.0

Weave is pre-1.0 today. By the letter of SemVer that means the API is still stabilizing
and anything may change — but in practice we hold ourselves to the policy above, and have
shipped over a hundred releases with no breaking change to the code you write.

**1.0 is the point at which "breaking changes only in a major version" becomes a firm
guarantee.** We'll cut it once the public API surface above is settled enough to stand
behind that promise without reservation.
