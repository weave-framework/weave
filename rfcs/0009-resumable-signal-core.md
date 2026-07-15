# RFC 0009: Serializable / Resumable Signal Core (Phase E — E0)

- **Status:** Draft — 2026-07-14
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** maintainer decision record; drafted with the AI pair (session ak).
- **Depends on / supersedes scope of:** [RFC 0001](0001-ssr-hydration.md) — 0001 fixed the *direction*
  (SSR, SSG-first) around **hydration**; this RFC defines the deeper primitive (**resumability**) that
  0001's client-attach step should be built on, and that local-first (a future RFC) reuses.

## Summary

Define the one shared, additive primitive at the bottom of Phase E: a **serializable signal graph** and
a **resume** contract. On a server (or a build) we snapshot the reactive graph — signal values,
computed dependencies, and the wiring needed to continue — into a compact, in-house wire format. On the
client we **resume**: rebuild the live graph from that snapshot and attach behaviour lazily, **without
re-running `setup`** and without re-creating the DOM. This is the foundation for two later surfaces —
**E1 SSR/SSG** and **E2 local-first** — which are two *applications* of the same capability, not two
independent builds.

No public 1.0 API changes. The existing eager client path is untouched; everything here is a new,
opt-in compile target + new runtime entries.

## Motivation

- **SSR/SSG (RFC 0001) needs a client-attach step.** The naïve version is *hydration*: re-run every
  component's `setup` on the client to rebuild the reactive graph, then adopt the server DOM. That pays
  the whole JS cost twice (render on the server, re-execute on the client) — the exact bloat Weave's
  "tiny" identity rejects. **Resumability** pays it once: serialize the graph on the server, resume it on
  the client, and run a component's logic only if/when the user actually interacts with it.
- **Local-first (E2) needs the same snapshot.** Persisting state to disk, syncing it, and rehydrating
  offline is *the same operation* as serialize→resume across the server/client boundary. Building the
  primitive once means E1 and E2 share it instead of duplicating it (RULE #1).
- **A signal-native, compiler-based framework is unusually well-placed for this.** Fine-grained signals
  already isolate exactly what depends on what; a snapshot of the graph is a snapshot of the app. Weave
  already splits `@weave-framework/runtime/dom` from the reactive core, so a headless render path is
  architecturally anticipated, not bolted on.

## Non-goals (for E0)

- No SSR server, no SSG build command, no islands — those are **E1** (a later RFC/spec on this base).
- No sync engine, no CRDTs — those are **E2**.
- No change to the eager client-only path, and no public API removal or change (I1 below).

## Design

### 1. The wire format (`serializeGraph` / `deserializeGraph`)

A compact, in-house, zero-dependency encoding of a reactive-graph snapshot. Requirements:

- **Structural sharing.** Repeated objects/subtrees encode once and reference by id (no JSON blow-up).
- **Cycle-safe.** The signal graph has cycles (a computed reading a signal that an effect writes); the
  encoder tracks visited nodes by id.
- **Typed leaves.** `Date`, `Map`, `Set`, `undefined`, `BigInt`, typed arrays survive round-trip (plain
  `JSON` loses them). An extension hook lets an app register a (de)serializer for a custom class.
- **Diff-friendly (forward-looking for E2).** The format is addressable by node id so a later sync layer
  can ship deltas, not whole snapshots. E0 ships full-snapshot only; the id scheme is the seam.
- **Non-serializable guard.** A value that cannot cross the boundary (a live socket, a DOM node, a
  closure that isn't a registered lazy handler) is a **build/`check`-time error**, not a runtime
  surprise (ties into AI-native contract A1).

Runtime surface (new, additive):

```
// server / build only — never in the client SPA bundle
serializeGraph(root: Owner): Wire

// client only — its own entry, 0 bytes for SPA-only apps
deserializeGraph(wire: Wire): ResumeHandle
```

### 2. Lazy handlers — the resumability primitive (`mode: 'resumable'`)

Resumability means client behaviour isn't wired until it's needed. The compiler gains a **new target**
`mode: 'resumable'` alongside the current `mode: 'eager'` (default, **byte-for-byte unchanged**):

- Event handlers compile to **serializable references** — an id that points at a lazily-importable chunk
  (`handler#42` → `import('./chunk-7.js').then(m => m.h42)`), not an eager closure captured at render.
- The server emits these ids as attributes on the HTML (`on:click` → a resume marker); no handler JS
  ships until the first interaction with that element.
- Captured state a handler needs is read from the resumed graph (§1), not from a re-run closure.

This is the same idea Qwik calls a `QRL`; here it is a compile target of the existing loader, so an app
opts in per build, and the eager path is always available as the zero-cost fallback.

### 3. The resume contract (`@weave-framework/runtime/resume`)

A new runtime entry (its own size-budget line; **0 bytes** for SPA-only apps):

1. Adopt the server-rendered DOM in place (no re-creation).
2. `deserializeGraph` the embedded snapshot → live signals/computeds, **without calling `setup`**.
3. Bind a lazy handler to a DOM node only on the first event that targets it (delegated listener →
   resolve the handler id → import → invoke), then upgrade that node to a normal listener.
4. From that point on, the app is indistinguishable from an eager client app.

**Invariant:** resuming must not call component `setup` functions. A conformance test asserts a spy on
`setup` is never invoked during resume (this is the behavioural definition of "resumable, not hydrated").

### 4. Headless DOM seam

`@weave-framework/runtime/dom` already exists as a separate entry. E0 finishes the seam so the reactive
graph can render to an **HTML string** server-side:

- No reach-through to `document` / `window` in the render path; DOM ops go through an injected surface
  that has a string-emitting server implementation.
- The eager browser implementation is unchanged (guarded by the full 1249-test suite).

## Invariants (these are gates, inherited from PHASE-E-PLAN.md)

| # | Invariant | Enforced by |
| --- | --- | --- |
| I1 | Public 1.0 API unchanged; additive only | `check` API-surface diff; typecheck |
| I2 | Eager client path untouched; full suite green every commit | `pnpm test` |
| I3 | SPA core stays ≤ 22 KB gz; `runtime/resume` its own budget; 0 bytes for SPA-only | `verify:size` |
| I4 | Zero third-party runtime deps — the serializer is in-house | `verify:size` + review |
| I5 | Driven by a real app need (the docs site is the first SSG dogfood, per RFC 0001) | dogfooding |

## Milestones (each shippable + gated; behind the flag, eager path untouched)

- **E0.1 — wire format.** `serializeGraph` / `deserializeGraph` + round-trip tests (nested, cyclic, typed
  leaves, custom-class hook). No compiler change yet.
- **E0.2 — lazy handlers.** Compiler `mode: 'resumable'` emits handler refs; eager codegen unchanged.
  Tests: emit shape + a resumed click invokes the right handler.
- **E0.3 — resume entry.** `runtime/resume` adopts DOM + rebuilds graph with **no `setup` re-run**
  (spy-asserted) + wires a handler on first interaction.
- **E0.4 — headless DOM seam.** Render a component tree to an HTML string in Node, no real DOM; browser
  path unchanged.

Exit E0: `resumable.browser.ts` + a Node SSR-render smoke green; `verify:size` shows SPA core flat and
`runtime/resume` within budget; a throwaway "hello, resumed" page renders on the server and resumes on
the client with `setup` never called on the client.

## Open questions (resolve as milestones land)

1. **Handler-chunk granularity** — one chunk per handler (max laziness, more requests) vs per-component
   vs per-route. Likely per-route default, per-component opt-in.
2. **Snapshot placement** — inline `<script type="application/weave">` vs a separate fetch. Inline for
   SSG; revisit for streaming in E1.
3. **Partial resume / islands boundary** — is an island just a resume root? (Probably yes — defer the
   API to E1.)
4. **Custom-class registry ergonomics** — global registry vs per-serialize options.
5. **`effect` on resume** — do effects re-run on resume, or only on first dependency change after resume?
   (Leaning: re-run once to reach a consistent DOM, then normal.)

## Alternatives considered

- **Hydration (re-run `setup` on the client).** Simpler, but pays the JS cost twice and grows the client
  bundle — rejected as contrary to the "tiny" identity; resumability is the whole point.
- **A third-party serializer / CRDT lib.** Violates RULE #1 and bloats the bundle; the format is small
  and purpose-built, so in-house wins.
- **Doing SSR (E1) without this core.** That is the hydration trap again, and it would not be reusable by
  local-first (E2) — the shared core is what makes "all three" one bet instead of three.

## First step

Land **E0.1 (wire format)** behind no flag at all — it is pure additive runtime API with zero effect on
existing apps — pinned by round-trip tests. It is the smallest slice that de-risks the whole track.
