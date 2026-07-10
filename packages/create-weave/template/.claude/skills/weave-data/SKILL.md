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
  // re-fetches whenever a tracked signal it reads changes (e.g. props.id)
  const user = resource(() => api.get(`/users/${props.id}`));
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
A resource exposes reactive `data()`, `loading()`, `error()`, and `refetch()`. Because the fetcher runs inside reactive tracking, reading a signal in it (a route param, a search query) makes the resource re-fetch when that input changes — no manual dependency wiring. Drive `@await` with the resource directly.

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
await save(patch);                 // runs the mutation; tracks in-flight state
```
Use `action` for mutations (create/update/delete) with in-flight + error state; wrap with `optimistic` to apply the change locally first and roll back if it fails. After a mutation, `refetch()` the affected resource (or update it optimistically) to reflect the new state.

## Where fetching lives

- **In a component**: a `resource` (this skill) — the common case.
- **In a route**: a route **`loader`** (weave-router) — data ready as the route renders, `useLoaderData()` gives the same `{ data, loading, error }`.
- Both feed `@await` identically, so the template code is the same.

## Patterns

- **Derive the URL/params from signals** in the fetcher so the resource re-fetches on change (search, pagination, route params). For search, debounce the query signal (`debounced`, weave-reactivity) to avoid a request per keystroke.
- **Loading/error UI** via `@await`'s pending/`@catch` branches — don't hand-roll `if (loading())` ladders when `@await` reads cleaner.
- **Errors**: catch `HttpError` and map `status` to a user message (403 → no-permission, 409 → conflict).
- **Cursor/infinite lists**: accumulate pages in a signal; append on "load more"; a `<List>`/`InfiniteScroll` (weave-ui) consumes them.

## Gotchas

- Read `data()`/`loading()`/`error()` with `()` — reactive.
- The fetcher must **read its inputs as signals** to re-fetch reactively; a value captured once won't trigger a refetch.
- Prefer `@await (resource)` over manual state juggling — it wires pending/value/error for you.
- Keep the network layer in a `client`/service module, not inline in every component, so headers/interceptors/error mapping live in one place.
