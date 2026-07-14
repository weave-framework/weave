# Phase E — Resumable, Isomorphic Signals (AI-native as the through-line)

> Status: **DRAFT for review** (not yet in ROADMAP, no code). One deep bet, staged and additive.
> The 1.0 public API is frozen — everything here is additive, deprecated-first. Nothing below
> starts before its predecessor's gates are green **and** a real dogfooding app needs it.

## 0. The one bet

A **serializable / resumable signal graph**. That single core primitive is the foundation for two
surfaces — **E1 SSR/resumability** and **E2 local-first sync** — which are two *applications* of the
same capability, not two separate builds. **A (AI-native)** is not a phase: it is the always-on
operating mode and the public identity ("the framework you build *with* AI"), and it is the
multiplier that lets a solo+AI team ship E0–E2 correctly.

```
A (always on) ── build-time contracts · MCP tooling · verifiable-by-AI
      │
      └── E0  serializable/resumable signal core   ← the hard, shared part
              ├── E1  SSR / SSG / resumability      (first surface)
              └── E2  local-first / sync            (second surface)
```

## 1. Invariants — these are GATES, not aspirations

| # | Invariant | Enforced by |
| --- | --- | --- |
| I1 | Public 1.0 API unchanged (additive, deprecated-first) | `weave check` API-surface diff; typecheck |
| I2 | Existing client-SPA path untouched; full suite green **every commit** | `pnpm test` (1249+ → grows) |
| I3 | SPA core stays tiny; resume/sync are opt-in, **0 bytes** for SPA-only apps | NEW `verify:size` gate |
| I4 | Zero third-party runtime deps (RULE #1) — serializer + CRDT built in-house | `verify:size` + review |
| I5 | Every milestone driven by a **real app need**, not speculation | dogfooding apps ([[weave-dogfooding-validation]]) |

## 2. Size budget (measured baseline, 2026-07-13)

Prod-shipping runtime, gzip: `reactive.js` **4.3 KB** + `dom.js` **16.7 KB** ≈ **21 KB** SPA core
(`devtools.*` is dev-only, excluded from prod). Budget:

- **SPA core (reactive + dom): ≤ 22 KB gzip** — hard ceiling; `verify:size` fails CI if exceeded.
- **`runtime/resume`: its own budget line** (target ≤ 6 KB gzip), loaded only in SSR/resume builds.
- **`@weave-framework/sync`: its own budget line**, 0 bytes unless imported.
- Every new subpath gets a budget entry the first time it ships.

## A — AI-native (starts now, continuous)

Goal: a framework an AI agent can author, refactor, and **prove correct** at build time.

- **A1 — build-time contracts.** Extend `weave check` with rules that turn runtime foot-guns into
  compile errors: uncleaned effects/subscriptions, a `resource` with no error branch, a component
  whose template reads a name it never exposes, a non-serializable value crossing a resume boundary
  (once E0 lands). Each rule ships with a `.smoke.mjs` under `verify:check`.
- **A2 — MCP toolchain deepening.** New tools on `@weave-framework/mcp`: `scaffold-component`,
  `verify-serializable`, `explain-diagnostic` (error id → cause + fix-it + doc link), `size-report`.
  Pinned by `verify:mcp` smokes.
- **A3 — diagnostics as fix-its.** Every `ParseError` / `check` error carries a machine-readable code,
  a suggested edit, and a doc URL (offsets already done in 1.5.14). Feeds A2's `explain-diagnostic`.
- **A4 — positioning.** One docs page on Weave's own terms — determinism, structured errors, MCP,
  skills — **no framework comparisons** ([[weave-no-framework-comparisons]]).

Exit: `verify:check` + `verify:mcp` cover the new contracts; the identity page is live.

## E0 — The serializable / resumable signal core

The crux and the biggest single effort in Weave's history. Built **behind a flag / as new entries**;
the eager SPA path is never touched. Milestones, each shippable + gated:

- **E0.1 — serialization boundary.** In-house compact wire format (structural sharing, no JSON bloat,
  zero deps). Runtime: `serializeGraph(root)` (server-only) / `deserializeGraph(wire)` (client-only
  entry). Tests: round-trip of nested signals/computeds; cyclic-ref safety.
- **E0.2 — lazy handlers (the resumability primitive).** New compiler target `mode: 'resumable'`
  alongside `eager`: event handlers compile to **serializable references** (`qrl`-style id → lazy
  import) instead of eager closures. Eager codegen byte-for-byte unchanged. Tests: emit shape +
  a resumed click invokes the right handler with no eager wiring.
- **E0.3 — resume entry.** `@weave-framework/runtime/resume`: attaches to server HTML, rebuilds the
  reactive graph from the serialized state **without re-running `setup`**, wires a lazy handler on
  first interaction with it. Tests: SSR HTML → resume → interactive, asserting `setup` is **not**
  called on the client.
- **E0.4 — headless DOM seam.** Confirm/complete the `@weave-framework/runtime/dom` abstraction so the
  reactive graph renders to an HTML string server-side (the split entry already exists — fill gaps:
  no `document`/`window` reach-through). Tests: render a component tree to a string in Node, no DOM.

Gate: new `resumable.browser.ts` + a Node SSR-render test; `verify:size` shows SPA core unchanged and
`runtime/resume` within its budget. Deliverable spec first: **RFC 0009** (wire format + resume
contract + compile-target design) before any code.

## E1 — SSR / SSG / resumability (RFC 0001 → Implemented)

Stands entirely on E0. Milestones:

- **E1.1 — `weave build --ssg`.** Render routes to static HTML at build (E0.4 headless + E0.1
  serialize); client "hydration" = resume (E0.3). The default, simplest surface.
- **E1.2 — islands.** Per-component resume boundaries: only interactive components ship handler chunks;
  static subtrees ship **zero** JS. Directly serves I3.
- **E1.3 — router + data integration.** Route loaders run server-side; `@weave-framework/data`
  results serialize into the resume payload so the client resumes with data already present.
- **E1.4 — streaming server adapter (optional).** Request-time render + stream + resume, behind a
  minimal server contract (user brings the host).

Gate: an SSG demo app builds, resumes, and is interactive with static subtrees shipping no JS;
`verify:size` per-page budget. RFC 0001 status → Implemented; SSR guide (own terms).

## E2 — Local-first / sync (new opt-in package)

Second surface on the same core; **0 bytes** unless imported. Milestones:

- **E2.1 — `@weave-framework/sync`.** Signals backed by a local store (IndexedDB), offline-first;
  reuses E0.1 for persistence.
- **E2.2 — in-house CRDT (RULE #1).** Start with LWW-register + a small map/list CRDT; no third-party
  CRDT lib. Serializer shared with E0.1.
- **E2.3 — pluggable transport.** We ship the sync *protocol*; the user brings the backend/websocket.
- **E2.4 — `syncedResource`.** An offline-capable reactive query that reconciles on reconnect —
  bridges `@weave-framework/data` and `sync`.

Gate: offline write → reconnect → merge round-trip + conflict-resolution tests; `verify:size` proves
0-byte impact on non-importing apps. Candidate as the **3rd dogfooding app**.

## Sequencing & exit criteria

1. **A** — now, continuous (identity + multiplier).
2. **E0** — next; ships milestone-by-milestone behind flags, SPA path untouched.
3. **E1** — begins once E0.1–E0.3 are green and an app needs SSG.
4. **E2** — begins once E1 has proven the core in a real app.

Each milestone: **spec → build → live-verify → per-milestone green commit** (the existing cadence).
No speculative building — a milestone waits for a real dogfooding-app pull.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Bloat (lose "tiny") | `verify:size` gate + eager path stays the zero-cost default |
| Scope stall (solo+AI) | Milestone-sized + shippable; A keeps authoring velocity high |
| Resumability complexity | Eager path is the always-working fallback; resumable is a separate target |
| Building ahead of need | I5 — every milestone gated on a real app requirement |
| API drift | I1 — additive-only, `check` API-surface diff |

## First concrete step

Write **RFC 0009 — Serializable / Resumable Signal Core** (E0 spec only: wire format, resume
contract, `mode:'resumable'` compile target, size budget). No code — the spec lets us size E0
precisely before committing to it. In parallel, land the **`verify:size` gate** with today's baseline
so "tiny" is protected from commit one.
