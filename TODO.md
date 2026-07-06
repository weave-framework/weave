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

- **Component extension — declarative template patches.** ([RFC 0008](rfcs/0008-component-extension.md), the `#3`
  follow-on.) A component can already **`extend`** another — reuse its whole `setup` context and behaviour,
  override/add on top, with a full-template override (shipped in 1.1.0; see
  [Extending a component](https://weaveframework.dev/learn/components)). Still planned: *declarative patches* against
  the base template (add just an attribute or a node without rewriting the whole template).
- **Server-side rendering — SSG first.** Accepted as a future track ([RFC 0001](rfcs/0001-ssr-hydration.md)):
  build-time prerendering + client hydration for SEO and first paint, before request-time SSR / streaming. Scheduled
  after the client-first roadmap matures, so it never comes at the cost of the core.

---

## Deliberately out of scope

Not planned — these are conscious design choices, not omissions:

- **Streaming SSR / RSC** — later phases of the SSR track above, only on real demand (the first cut is static
  prerendering + hydration).
- **A full animation system** beyond the transition callbacks above — CSS covers the rest.
- **RxJS interop** — the reactive model is signal-native by design.
