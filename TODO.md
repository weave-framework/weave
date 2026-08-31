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

## Planned — migration

- **`weave migrate` for React (and others).** ([RFC 0011](rfcs/0011-migrate.md) — Angular shipped in 2.2.0.)
  The command is built as a front door with a source-framework module behind it: the dependency walk, the plan
  writer and the output layout are language-level and already shared, so a second source framework is a module,
  not a second tool. React is the next one intended.

## Planned — tooling

- **Content-hashed output filenames.** `weave build` versions its injected URLs (`/main.js?v=1a2b3c`), which
  busts a cache correctly. Hashed *filenames* (`main-a1b2c3.js`) would additionally let a host serve the
  bundle as immutable. It is a rename of the build's outputs, so it lands as its own change rather than
  riding along with something else.
---

## Deliberately out of scope

Not planned — these are conscious design choices, not omissions:

- **Request-time SSR and streaming** — static generation shipped in 1.6.0 and covers SEO and first paint
  without a server in the request path. Rendering per request is a different set of trade-offs and waits for a
  real need, not a checklist.
- **A full animation system** beyond the transition callbacks above — CSS covers the rest.
- **RxJS interop** — the reactive model is signal-native by design.

- **An implicit lexical scope for props** ([RFC 0012](rfcs/0012-ambient-scope.md) — Declined). The idea
  removed props that exist only to be passed to a child. The RFC set its own threshold — single digits
  and it is not worth the risk — and named the trigger: re-measure on a deep real application. Measured
  across **585 components and 170 props in five applications, including two deep business ones: zero**.
  Not close to the line. A component would have started resolving names from wherever it was placed,
  which is a large change in what code means, to remove a problem that does not occur.

- **Splitting below the component.** Shipping *one handler* and nothing else, so a mostly-static page
  pays only for the island on it. Measured before building: handler bodies are **0–3% of a compiled
  component** across four real applications — the rest is the render path, the templates and the adopt
  walk. Splitting out the handlers alone would save almost nothing, and the machinery it would need
  sits on a resumable target that still declines a fraction of real components.
