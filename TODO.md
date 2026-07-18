# Weave — public roadmap

The substantial things we intend to build, and the things we have deliberately left out.

**What belongs here:** whole features and multi-session efforts — a new subsystem, a cross-cutting
capability, a milestone. Not individual bug fixes, polish, or a single component tweak; those live in the
commit history and `CHANGELOG.md`.

**How it stays honest:** this list is reviewed at **every release**. Anything a release finishes is removed
here (it graduates to `CHANGELOG.md`); anything substantial we newly decide to defer is added. So an item on
this list is a live intention, not a historical note.

---

## Planned — UI library

- **Permanent live component gallery.** A hosted, always-current gallery of every component and its variants.
- **UI testing harnesses** (`@weave-framework/ui/testing`). Ready-made utilities for consumers to drive and
  assert Weave components in their own tests (open an overlay, exercise the keyboard map, check focus return).

## Planned — framework

- **Component extension — `weave check` for patch markup.** ([RFC 0008](rfcs/0008-component-extension.md) —
  the last follow-on.) Extending a component already works both ways — a full-template override, or
  *declarative patches* against the base template (see
  [Extending a component](https://weaveframework.dev/learn/components)). What's still planned is `weave check`
  type-checking of the markup inside `patch` ops: today a typo in a patched expression surfaces at
  build/runtime rather than in the editor, while full overrides are already fully checked.
- **Splitting below the component.** `weave build --ssg` splits per route, and `lazy()` splits per component —
  but an interactive component still carries its whole module. Shipping *one handler* and nothing else, so a
  mostly-static page pays only for the island on it, is sketched in
  [RFC 0009](rfcs/0009-resumable-signal-core.md) and not built. Zero JS is reachable today, but you draw the
  line yourself.

---

## Deliberately out of scope

Not planned — these are conscious design choices, not omissions:

- **Request-time SSR and streaming** — static generation shipped in 1.6.0 and covers SEO and first paint
  without a server in the request path. Rendering per request is a different set of trade-offs and waits for a
  real need, not a checklist.
- **A full animation system** beyond the transition callbacks above — CSS covers the rest.
- **RxJS interop** — the reactive model is signal-native by design.
