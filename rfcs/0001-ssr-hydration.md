# RFC 0001: Server-side rendering & hydration

- **Status:** **◐ Partially implemented** — 2026-07-17. Accepted 2026-07-04.
  **Phase 1 (SSG) is delivered; request-time SSR and streaming are NOT built and remain deliberately deferred**
  — exactly as this RFC scoped itself. Do not read this as the whole RFC being implemented.
  This RFC scoped Phase 1 to **SSG only**, explicitly deferring request-time SSR, streaming and RSC.
  That scope is delivered, and the client-attach step is **resume** rather than the hydration this RFC assumed
  — the deeper primitive [RFC 0009](0009-resumable-signal-core.md) defined and this RFC's own header points at.
  Every exit criterion in PHASE-E-PLAN, checked against a real build rather than an intention:
  - **builds · resumes · is interactive** — `weave build --ssg` prerenders every route; the client adopts that
    DOM and `setup` never re-runs. Gated by `pnpm verify:resume`: a real app, the real CLI, a real browser.
  - **data** — a `resource()` is awaited before the HTML is written and travels in the snapshot, so the client
    resumes with it present (E1.3). Gated, with the failure mode pinned alongside it.
  - **static subtrees ship no JS** — per-route splitting by default, per-component via `lazy()`, which now
    prerenders (see RFC 0009 Q#1). Measured on the docs: a page went **1555.7 KB → 169.7 KB raw**.
  - **per-page budget** — `verify:resume` pins 7.6 KB gz + a 135 B snapshot on a 3-component page; drop it to
    7 KB and the gate fails.
  - **SSR guide** — `/learn/static-generation`, on Weave's own terms, and it documents what CANNOT resume as
    plainly as what can.

  **Honest edges.** "Zero JS" is reachable, not automatic: a static subtree inside an eagerly-imported
  component still ships, and `lazy()` is the author's opt-in. Per-HANDLER chunks (RFC 0009 §2's sketch —
  a chunk per `on:click`) are not built. Request-time SSR + streaming remain out of scope, as decided here.

  **And the one that matters most: I5 (dogfooding) is NOT satisfied.** This RFC names the docs site as the
  first SSG dogfood, and the DEPLOYED docs do not run `--ssg` at all — `docs:build` is a plain `weave build`,
  so `weaveframework.dev` is a client-rendered SPA and nothing above reaches a real reader. What holds the
  claim up instead is `verify:resume`: a real app, through the real CLI, resumed in a real browser, on every
  push. That is a stronger gate than a site nobody re-checks, but it is not the same as production.
  Switching the deploy is a separate, unmade decision, and it has one thing that cannot be measured from here:
  whether Cloudflare maps `/learn/templates` → `/learn/templates/index.html`. If it misses, the
  `not_found_handling = "single-page-application"` fallback serves the HOME page's HTML — harmless for a SPA,
  wrong under resume (a foreign snapshot). MEASURE that on a real deploy before turning resume on.
  (Note the payload win is INDEPENDENT of all this: per-page chunking comes from `lazy()` + splitting, so a
  plain `weave build` already carries it — measured, /learn/templates 1127.4 → 132.4 KB raw.)
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** decided directly by the maintainer (no community to gauge yet); this RFC is
  the decision record.

## Decision (2026-07-04)

**Accepted, with a deliberately narrow scope and schedule.** Server rendering is a real gap in
what Weave can do, and it is the single most-cited blocker for content-first / SEO-sensitive
adopters. We commit to closing
that gap. But it is also the largest permanent cost Weave can take on — a *second render path,
maintained forever* — and a half-built SSR would damage trust more than its absence. So:

1. **Phase 1 = SSG only** (build-time prerender + client hydration). It closes the most
   valuable slice (SEO + first paint for static/content pages), needs the same hydrate
   investment as full SSR, and would **dogfood on the Weave docs site itself**. Request-time
   SSR, streaming, islands, and RSC are explicitly **later phases**, not the first cut.
2. **Sequenced after Phase C** brings the client-first framework to a 1.0-worthy state. SSR is
   a parallel *future* track with its own milestones; it must not freeze or slow the
   client-first roadmap. **Not started now.**
3. The open design questions below (server strategy, data serialization, mismatch policy) are
   resolved when Phase 1 work actually begins — this decision fixes the *direction and scope*,
   not the final API.

One line: **yes we close the gap, starting with the smallest viable slice (SSG), after the
client story is polished** — not dropping everything for the full streaming beast now, nor
pretending the gap doesn't exist.

## Scope note

`ROADMAP.md` previously listed SSR / hydration / streaming / RSC under *“Out of scope
(confirmed)”*. This RFC supersedes that line: SSR is now an **accepted future track, scoped to
SSG-first and scheduled post-Phase-C**. The sections below are the design of record.

## Summary

Give Weave an optional server-rendering path: render a component tree to an HTML string on
the server (no browser), send that markup, and on the client **hydrate** it — attach the
signal bindings to the already-present DOM instead of recreating it. The goal is faster
first paint and crawlable HTML for content sites, without changing how anyone authors a
component.

## Motivation

Weave today is client-rendered: the browser downloads JS, runs `mountComponent`, and builds
the DOM. That is great for apps behind a login, but it costs on:

- **First contentful paint** for content-first pages (marketing, docs, blogs, commerce
  listings) — the user waits for JS before seeing anything.
- **SEO / link previews** — crawlers and unfurlers that don’t run JS see an empty `#app`.
  (Our own docs work around this only because they’re a rich SPA a human drives.)

These are the two requests most likely to block adoption by teams building content-first
sites. Everything else Weave already does well; this is the gap that turns “nice framework”
into “can’t use it for our marketing site.”

It’s worth *considering* now (not necessarily building now) because the architecture that
makes Weave fast on the client — compiled templates with **compile-time child-index paths**
and fine-grained bindings — is unusually well suited to hydration, and we should decide the
shape before more surface area (router v2, forms v2) is built in a client-only way.

## How it fits Weave

The non-negotiables constrain the design more than they forbid it:

- **Zero runtime dependencies.** Rules out jsdom / happy-dom on the server. The server
  renderer must be in-house — either a string-emitting compiler target or a minimal
  server-DOM shim we own. (Native `Intl`/etc. are fine; a third-party DOM is not.)
- **One reactive model.** No new primitive. On the server we run `setup()` and read signals
  **once** to produce initial HTML; effects that touch the DOM simply don’t run (there is no
  DOM). Hydration re-uses the exact same `bindText`/`bindAttr`/… helpers, pointed at existing
  nodes.
- **Compose, don’t duplicate.** Hydration must reuse the compiler’s existing child-index
  paths and binding helpers — not a parallel renderer. If we can’t hydrate with the same
  codegen (one extra mode), the design is wrong.
- **Fail loud.** Hydration mismatches (server HTML ≠ what the client would render) must warn
  clearly in dev, with the offending path, not silently double-render.
- **Accessible by construction.** SSR must preserve the ARIA the components already emit; the
  server string is the same markup, so this mostly falls out — but focus/live-region timing
  needs a hydration story.

## Design

> **What actually shipped (2026-07-17) — read this before the design below.** The sections that
> follow are the design as proposed; the delivered API differs and the delivered API is what
> exists. Verified against source:
>
> | Proposed here | Shipped |
> |---|---|
> | `@weave-framework/ssr` package | **no such package** — server rendering lives in `@weave-framework/runtime/server` (`renderToString`, `renderComponent`, `renderPage`, `renderDocument`; `packages/runtime/src/server.ts`) |
> | `renderToString(App, { props })` | `renderToString(node)` — takes an already-rendered node, not a component + props |
> | `hydrate(App, '#app', { props })` from `runtime/dom` | **no `hydrate`** — the client attaches by **resume**: `resumePage()` / `resume()` in `@weave-framework/runtime/graph`, per RFC 0009 |
> | a compiler "hydrate mode" whose `bindX` helpers skip the initial write | a **resumable codegen target** (`resumable` option in `packages/compiler/src/codegen.ts`) plus adopt helpers in `@weave-framework/runtime/adopt` |
> | (not proposed) | the build entry point: `weave build --ssg`, configured by `ssg: { routes?, resume? }` in `weave.config.ts` (`packages/cli/src/config.ts`) |
>
> The mismatch-policy machinery this RFC anticipated is moot in the shipped shape: a component
> that cannot adopt the server DOM degrades to a plain client-rendered island in place rather
> than reconciling a diff.

Three pieces: a **server render**, a **hydrate** entry, and the **compiler** support that
lets one component definition do both.

### 1. Compiler: a hydrate mode

The client codegen already emits, per fragment:

```js
const _r = clone(_t0);              // create DOM
const _n0 = child(_r, 1);           // locate a dynamic node by compile-time path
bindText(_n0, () => ctx.count());   // wire a binding
```

Hydration keeps the **paths and bindings** but swaps DOM *creation* for DOM *adoption*:

```js
const _r = adopt(hydrationCursor);  // take the next server node instead of cloning
const _n0 = child(_r, 1);           // same path — the server emitted the same structure
hydrateText(_n0, () => ctx.count());// attach; DON'T overwrite text that already matches
```

The `bindX` helpers gain hydrate-aware variants (or a global “hydrating” flag) that **skip
the initial write** when the current DOM already equals the computed value, and only attach
the reactive subscription. Control-flow blocks (`@if`/`@for`/`@await`) adopt their
server-rendered branch/rows by walking the same comment anchors the client emits, then
subscribe for subsequent updates.

### 2. Server render → string

Two candidate strategies (pick one in review):

- **(A) String codegen target.** A third compiler mode emits an HTML-string builder instead
  of DOM calls: static chunks are concatenated, bindings are read once and escaped into the
  string, control-flow becomes loops that append. Fastest, no DOM on the server, but it is a
  *second* code path to keep in sync with the DOM one.
- **(B) Minimal server-DOM shim.** A tiny in-house `Document`/`Element` implementing just the
  subset the runtime touches (`createElement`, `setAttribute`, `textContent`,
  `insertBefore`, `innerHTML` parse for `template()`), then serialize. Reuses the *existing*
  codegen unchanged; costs a shim to build and keep correct.

Either way the public API is small:

```ts
import { renderToString } from '@weave-framework/ssr';
const html = await renderToString(App, { props }); // awaits @await/resources first
```

### 3. Client: hydrate entry

```ts
import { hydrate } from '@weave-framework/runtime/dom';
hydrate(App, '#app', { props }); // adopt the server DOM under #app, wire bindings
```

`hydrate` mirrors `mountComponent` but runs the component in **hydrate mode** against the
container’s existing children.

### 4. Async data

`@await` / `@weave-framework/data` resources must settle on the server before serialization
(`renderToString` awaits the tree’s pending resources), and their resolved values must be
**serialized into the page** (a `<script type="application/json">` payload) so the client
hydrates with the same data instead of re-fetching. This is the part that leaks into the
router (route-level data loading) and is the main reason to design it before router v2.

### 5. Framework touch-points

Router (server needs the URL + a way to render the matched route), forms (initial values must
match), i18n (server locale), and `@weave-framework/data` (serialize/rehydrate cache) all need
a small SSR-awareness. Custom-element / `defineCustomElement` interop stays client-only.

## Alternatives considered

- **Do nothing.** The `/enterprise/incremental-adoption` story (embed Weave as a custom
  element in an existing app) already covers “add Weave to a server-rendered app you already
  have.” For teams that just need SEO on a few pages, that plus prerendering may be enough.
  Weakness: doesn’t serve “build the whole content site in Weave.”
- **Static generation (SSG) first.** A build-time prerender (run `renderToString` per route at
  build, ship static HTML + hydrate) is a strict subset of this design and a much smaller
  first deliverable. Strong candidate for **phase 1** — it needs the same server-render +
  hydrate, minus the request-time server and streaming. Recommend landing SSG first if this
  RFC is accepted.
- **Islands / partial hydration.** Hydrate only interactive regions, ship the rest as inert
  HTML. Powerful for content sites but a bigger conceptual change (authoring boundaries);
  defer to a follow-up once basic hydration exists.
- **Streaming SSR / RSC.** Explicitly out of the first cut — large, and only worth it after
  the string+hydrate baseline proves out.

## Drawbacks & risks

- **A second render path.** Whichever server strategy we choose, we now maintain SSR
  alongside CSR forever; every new control-flow feature or binding must render on both. This
  is the single biggest cost and the main reason SSR was parked.
- **Hydration mismatches** are a notorious class of bugs (locale/date/random differences,
  conditional markup). Needs a robust dev-time diff + clear errors, and discipline in
  components to be deterministic.
- **In-house server renderer.** Zero-dep means we build (A) or (B) ourselves and keep it
  correct against real HTML edge cases (foreign content / SVG — note the recent SVG-namespace
  fix, `void` elements, attribute escaping).
- **Ecosystem reach.** Router, forms, i18n, data all need SSR-aware changes; this is not a
  single-package feature.
- **Complexity budget.** This is the largest single item Weave would take on. It should not
  block or slow the client-first roadmap (Phase C) — it is a parallel track with its own
  milestones.

## Unresolved questions

1. **Server strategy (A) string-codegen vs (B) DOM-shim** — which keeps the two render paths
   most reliably in sync at the lowest maintenance cost?
2. **SSG-first?** Should phase 1 be build-time prerender only, deferring the request-time
   server and data-serialization until the hydrate path is proven?
3. **Data serialization format & API** — how do resources/stores serialize into the page and
   rehydrate without a re-fetch, and how much of that is router-owned?
4. **Mismatch policy** — warn-and-recover (client wins) vs warn-and-keep (server wins) in dev
   and in prod.
5. **Does this change any client-only assumptions in router v2 / forms v2 that we should
   pre-empt now**, even if SSR itself lands later?
