# RFC 0007: DevTools deep — trigger-trace & component tree

- **Status:** Draft (build spec) — 2026-07-05
- **Author(s):** Aidas Josas (@aidasjosas) — prep for a dedicated session; the depth follow-on to
  the shipped DevTools (introspection `0.2.131`, reactive panel + dep-graph this session).
- **Discussion:** design direction + first steps.

## Summary

The DevTools panel today lists named nodes with live values and a **structural** dependency
graph (`inspectGraph()` edges: who reads whom). Two depth features remain from the C3 roadmap
item: a **temporal trigger-trace** (`inspect(sig)` — *why* did this recompute, and what did
changing it cause) and a **component/owner tree** (the scope hierarchy, not a flat list).

## Motivation

- A flat node list + static edges answer "what depends on what" but not "**what just happened**"
  — the question you actually have when debugging an unexpected re-render.
- A component tree maps the reactive graph back onto the shape developers think in (components /
  scopes), the way React/Vue DevTools show a tree.

## How it fits Weave

- **Zero-cost when off.** Like the existing layer, tracing records nothing unless
  `enableDevtools()` is on; the ring-buffer is bounded.
- **One reactive model.** The core already has the edges (`track` populates `source.observers` /
  `listener.sources`) and the owner tree (`createOwner` parent links) — this exposes what's
  already there, no new primitive.
- **Compose.** Builds on `devtools.ts` (`registerDevNode`, `inspectGraph`) and the panel.

## Design

### 1. Trigger-trace — `inspect(sig)` / `inspectTrace()`

Record, in a bounded ring-buffer, each propagation event: when a source changes and marks an
observer dirty, push `{ from, to, at }` (ids + a monotonic counter — no `Date.now()` in the
core). Expose:
- `inspectTrace(limit?)` → recent trigger events (newest first).
- `inspect(node)` → that node's slice: what triggered its recent recomputes, and what it caused.

The core hook is small: in `markDirty` / the notify path, if devtools are on and both ends are
registered, append to the buffer. The panel gains a "Trace" view (live log) and clicking a node
filters the trace to it.

### 2. Component / owner tree

Owners already form a tree (`createOwner(parent)`). To show it:
- Let an owner carry an optional **name** (a component sets it — e.g. `mountComponent` names the
  owner after the component). Add a nullable `name` + keep the parent link readable.
- `registerDevNode` already gets the internal node; also capture the **owner** at registration so
  each DevNode knows its scope.
- `inspectTree()` → the owner hierarchy with each scope's named nodes nested under it.
- Panel: a collapsible tree (scope → child scopes → nodes) as an alternative to the flat list.

## First steps (for the building session)

1. **Trace buffer** in `devtools.ts` (`inspectTrace` + `inspect(node)`), + the one `markDirty`
   hook in `reactive.ts` (guarded by `isDevtoolsEnabled()`). Tests: A→B change records an edge event.
2. Panel "Trace" tab (live log, click-to-filter).
3. **Owner naming**: optional `name` on `Owner`; `mountComponent` sets it. Capture owner in
   `registerDevNode`. Tests: a node reports its owner; the tree nests.
4. `inspectTree()` + panel tree view.
5. Docs (Tooling → DevTools): trace + tree.

## Alternatives considered

- **Full time-travel / snapshots.** Much larger; the ring-buffer trace covers the common
  "what just fired" need first.
- **Instrument at the panel** (poll diffs) instead of the core. Rejected — can't see *causation*
  (which source), only *changes*.

## Unresolved questions

1. Ring-buffer size / overflow policy (drop-oldest, configurable?).
2. Owner naming: automatic from `mountComponent` only, or a `name` option on more scopes?
3. Perf: even gated, is the `markDirty` append cheap enough to leave in for `enableDevtools()`
   sessions on a large graph? (Bench with the existing harness.)
