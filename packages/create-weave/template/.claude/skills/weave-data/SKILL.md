---
name: weave-data
description: >-
  Async data fetching and mutations in a Weave app with @weave-framework/data.
  Use this whenever a component loads or mutates server data: `resource` (reactive
  fetch with loading/error), `createClient` (base URL, headers, interceptors),
  `action` (mutations), `optimistic` updates, `HttpError`, and driving `@await`
  with a resource. Reach for it on any mention of fetching, API calls, loading/
  error states, caching, refetch, mutations/POST/PUT/DELETE, or "load data from the
  server" — even a casual "fetch the users".
---

# Weave data

`@weave-framework/data` turns async I/O into **reactive resources**: a `resource`
re-fetches when its inputs change, exposes `{ data, loading, error }` (the same
`@await`-compatible shape a route loader returns), and integrates with the signal
graph. Zero third-party deps — a thin, typed layer over `fetch`.

## A resource in a component

```ts
import { resource } from '@weave-framework/data';
export function setup(props: { id: string }) {
  // 2-arg form: the SOURCE is the tracked dependency, its value is handed to the fetcher
  const user = resource(() => props.id, (id, { signal }) => api.get(`/users/${id}`, { signal }));
}
```
```html
@await (user) {
  <Spinner />
} @then (u) {
  <Profile user={{ u }} />
} @catch (e) {
  <Alert>{{ String(e) }}</Alert>
}
```
A resource exposes reactive `data()`, `loading()`, `error()`, `refetch()`, and `mutate(value)` (write `data` directly, without fetching). Drive `@await` with the resource directly.

> **⚠ The fetcher does NOT track signals.** It is deliberately deferred to a microtask so it never subscribes to anything it reads. Reactivity comes **only** from the `source` in the two-argument form:

```ts
resource(fetcher, opts?)              // runs once — nothing to re-fetch on
resource(source, fetcher, opts?)      // re-fetches whenever source() changes
```
So a one-argument `resource` whose fetcher interpolates `props.id` will fetch once and **never re-fetch when `id` changes** — a silent bug. Put every reactive input in the `source`, and read it from the fetcher's first parameter.

A `source` of `undefined`, `null`, or `false` means **"not ready"** and skips the fetch (keeping the last data and clearing `loading`) — that's the idiom for a dependent fetch: `resource(() => userId() ?? false, …)`.

The fetcher receives `(value, { signal, refetching })` — pass `signal` to `fetch` so a superseded request aborts; `refetching` is `true` only for a manual `refetch()`. Aborts are swallowed rather than surfaced as errors.

## A client (base URL, headers, interceptors)

```ts
import { createClient } from '@weave-framework/data';
export const api = createClient({
  baseUrl: '/api',
  headers: () => ({ Authorization: `Bearer ${useAuth().token()}` }),  // reactive headers
  // interceptors: refresh-on-401, logging, etc.
});
// api.get(path) / api.post(path, body) / … return typed promises; non-2xx throws HttpError
```
`HttpError` carries `status` so you can branch (`err.status === 403 → 'no permission'`). Interceptors handle cross-cutting concerns (auth refresh, tracing).

## Mutations & optimistic updates

```ts
import { action, optimistic } from '@weave-framework/data';
const save = action((patch: UserPatch) => api.patch(`/users/${id()}`, patch));
await save.run(patch);             // NOTE: .run(input) — the action object is not callable
save.pending();                    // reactive in-flight flag
save.error();                      // last rejection (cleared at the start of each run)
save.result();                     // latest resolved result
```
`action` returns an **object**, not a function: call `save.run(input)`. If runs overlap only the **latest** updates the signals (a stale slow run can't clobber a newer one), while every caller still gets its own promise back — and `run` re-throws on failure, so `await` it in a `try`/`catch` if you need to react locally.

**`optimistic(base, reduce?)`** overlays pending updates on a base value and reconciles automatically:
```ts
const list = optimistic(() => todos.data() ?? [], (cur, added: Todo) => [...cur, added]);
list.value();          // base with every pending update folded in — render this
list.add(newTodo);     // show it immediately
```
It exposes only `value()` and `add(u)`. There is **no explicit rollback call**: the overlay is cleared automatically the next time `base` changes (i.e. when the real data lands, whether the mutation succeeded or failed — so a failure reverts by virtue of the refetch). The default `reduce` replaces the value. Call it inside a component `setup` so its internal watcher disposes on unmount.

After a mutation, `refetch()` the affected resource (or write it directly with `mutate()`).

## Where fetching lives

- **In a component**: a `resource` (this skill) — the common case.
- **In a route**: a route **`loader`** (weave-router) — data ready as the route renders, `useLoaderData()` gives the same `{ data, loading, error }`.
- Both feed `@await` identically, so the template code is the same.

## Patterns

- **Put every reactive input in the `source`** (search, pagination, route params) — never inside the fetcher. For search, make the `source` a `debounced` signal (weave-reactivity) to avoid a request per keystroke.
- **Loading/error UI** via `@await`'s pending/`@catch` branches — don't hand-roll `if (loading())` ladders when `@await` reads cleaner.
- **Errors**: catch `HttpError` and map `status` to a user message (403 → no-permission, 409 → conflict).
- **Cursor/infinite lists**: accumulate pages in a signal; append on "load more"; a `<List>`/`InfiniteScroll` (weave-ui) consumes them.

## Gotchas

- Read `data()`/`loading()`/`error()` with `()` — reactive.
- **The fetcher is untracked.** Signals read inside it create no dependency — use the two-arg `resource(source, fetcher)` form or it will fetch exactly once.
- **`action` is called as `save.run(input)`**, not `save(input)`.
- Prefer `@await (resource)` over manual state juggling — it wires pending/value/error for you.
- Keep the network layer in a `client`/service module, not inline in every component, so headers/interceptors/error mapping live in one place.
