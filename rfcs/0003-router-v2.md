# RFC 0003: Router v2 (Phase C — C5)

- **Status:** ✅ **Implemented** — shipped in `@weave-framework/router` and frozen at 1.0. Accepted
  (as a build spec) 2026-07-04. Verified against `packages/router/src/index.ts`: `createRouter(routes,
  { basename?, viewTransitions? })`, `route()` with path-literal param inference, `useRouter()`,
  `useLoaderData<T>()`, `RouterView`, `Link`, and the retained module sugar (`navigate`, `back`,
  `currentPath`, `currentQuery`, `afterEach`, `beforeEach`, `setScrollHandling`, `setBasename`,
  `prefetch`). U1–U4 all landed; U5 (Tier-2 quick wins) also shipped.
  **Divergence from the spec below:** `beforeEach` (a leave guard) and `setServerLocation` are part of
  the shipped surface and are not in the API sketch here.
- **Author(s):** Aidas Josas (@aidasjosas) — design decisions delegated to and locked by the
  maintainer's agent this session.
- **Discussion:** decision record for the C5 roadmap item; the public router API frozen at 1.0
  is the surface defined here.

## Summary

Evolve `@weave-framework/router` from a single module-global router into a **per-instance
router that owns its signals**, add **typed route params** (inferred from the path literal),
**route-level data loaders** (SSR-aware, `@await`-compatible), and optional **native View
Transitions**. This is the last large public-API surface before the **API freeze → 1.0** gate
(see [[weave-launch-sequencing]]); breaking changes are made *now*, deliberately, so 1.0 can
promise stability.

## Motivation

- **SSR-readiness.** Module-level `path`/`search` singletons make a per-request server router
  impossible. RFC 0001 (SSR) explicitly flags "does router v2 bake in client-only assumptions
  we should pre-empt?" — this RFC answers it: the router owns its state, so a server render can
  give each request its own router + URL. Doing router v2 *before* SSR de-risks the most.
- **Typed params.** `/user/:id` today yields an untyped `Record<string,string>`; developers
  want `params.id` to exist and be typed.
- **Data loading.** Route-level loaders are table-stakes for a router of this kind; today loading
  is punted entirely to the component. Loaders also serialize cleanly for SSR.
- **View Transitions.** The native API is now broadly available; wiring it into navigation is a
  cheap, high-delight win.

## How it fits Weave

- **Zero runtime dependencies** — all in-house; loaders reuse `@weave-framework/data` +
  `@await` v2 (C2), no new async primitive.
- **One reactive model** — a router instance's `path`/`query`/`params`/loader-data are all
  signals/computed; nothing new.
- **Compose, don't duplicate** — loader pending/error is the existing `@await` v2 reactive
  source, not a second Suspense.
- **Fail loud** — redirect loops already capped; typed-param mismatches are compile-time.
- **Accessible** — `<Link>` `aria-current`, scroll/focus handling on nav preserved; View
  Transitions must not break focus management.

## Design — locked decisions

Five open questions were delegated to the agent and locked as:

1. **Route authoring → a `route()` builder.** Keeps the object ergonomics but captures the path
   literal in a generic so params infer. Plain-object routes still accepted (untyped params) for
   back-compat.
2. **Loader data → a `useLoaderData<T>()` hook** (canonical; flexible for nested routes).
   `params` stays a component prop as today.
3. **Loader pending/error → the `@await` v2 reactive resource.** A loader's result is an
   `@await`-compatible source; optional `pending` / `error` slots on `<RouterView>` are sugar
   for route-level loading UI.
4. **View Transitions → native when available** (opt-in `viewTransitions: true`), the existing
   Weave `transition` prop as fallback/complement.
5. **Module sugar kept** (`navigate` / `currentPath` / `currentQuery` / `back`) — now delegates
   to the context (or most-recent) router. Canonical is `useRouter()`.

### Public API (the frozen surface)

```ts
// instance owns its signals
const r = createRouter(routes, { basename?, viewTransitions? });
r.path(); r.query(); r.params(depth?); r.navigate(to); r.back(); r.chain(); r.matched(d?);

// in a component
const r = useRouter();                 // inject from context
const data = useLoaderData<User>();    // this route's loader result (@await-compatible)

// typed routes
route('/user/:id', { component: User, loader: ({ params, query, signal }) => fetchUser(params.id) });
//                                                        ^ params.id: string (inferred)

// components
<RouterView router={r} />              // top; nested <RouterView/> inside layouts
<RouterView router={r}>                //   optional route-level loading UI
  <template #pending>…</template><template #error>…</template>
</RouterView>
<Link to="/about" activeClass="active" exact prefetch />

// module sugar (delegates to current/active router)
navigate('/x'); back(); currentPath(); currentQuery(); afterEach(fn); setScrollHandling(on); setBasename(b); prefetch(to);
```

## Build units (each: spec → live-verify → green commit)

- **U1 — Router owns its signals.** Move `path`/`search`/`query`/nav/hooks onto the instance;
  provide via context; add `useRouter()`; keep module sugar delegating to the context/active
  router. Existing 30 browser tests stay green (sugar preserves v1 semantics). *Foundational.*
- **U2 — `route()` builder + typed params** (template-literal inference). Plain objects still
  accepted.
- **U3 — Route-level loaders + `useLoaderData()`** wired through `@await` v2; design the
  SSR-serialization seam (data → page payload → hydrate) even though SSR itself lands in
  Phase D. Optional `pending`/`error` slots on `<RouterView>`.
- **U4 — Native View Transitions** (`viewTransitions: true`), Weave `transition` fallback.
- **U5 — Tier-2 quick wins** (optional, slot between): reactive CSS `style:--x={{ sig }}`,
  `<KeepAlive>`, `<Dynamic is={{ }} />` — only if in scope this run.

## Alternatives considered

- **Keep module singletons, add a second "server router".** Two code paths, exactly the split
  RFC 0001 warns against. Rejected.
- **Loader data as a prop, not a hook.** Simpler but awkward for deeply-nested layouts and
  collides with param typing. Hook chosen; prop access can be added later if wanted.
- **A bespoke router Suspense.** Duplicates `@await` v2. Rejected (compose, don't duplicate).

## Drawbacks & risks

- **Breaking change** for anyone importing the module-level state directly — mitigated by
  keeping the sugar working, and this is the pre-1.0 window to break.
- **Typed-params inference** via template-literal types can get hairy on edge patterns
  (optional/splat segments) — start with `:param`, extend carefully.
- **Loader ↔ data ↔ SSR seam** is the part most likely to churn; U3 designs the seam but full
  SSR wiring is Phase D.

## Unresolved questions

1. Splat/optional param typing (`*`, `:id?`) — support in v2 or defer?
2. Does `useLoaderData()` re-run the loader on param-only changes, or reuse via the data cache
   key? (Lean: cache-keyed, re-run on key change.)
3. Exact `<RouterView>` slot syntax for `pending`/`error` (named slots vs props).
