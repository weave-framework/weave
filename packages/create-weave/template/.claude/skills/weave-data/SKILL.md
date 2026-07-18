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
A `Resource<T>` exposes reactive `data()`, `loading()`, `error()`, plus `refetch()` and `mutate(value)` (write `data` directly, without fetching). Drive `@await` with the resource directly.

```txt
Resource<T>          { data(): T|undefined, loading(): boolean, error(): unknown,
                       refetch(): void, mutate(value: T|undefined): void }
Fetcher<S, T>        (value: S, info: FetchInfo) => Promise<T> | T
FetchInfo            { signal: AbortSignal, refetching: boolean }
ResourceOptions<T>   { initialValue?: T }
```
`ResourceOptions` has exactly one field: `initialValue`, the seed `data()` returns until the first fetch resolves. `error()` is `unknown`, not `Error` — narrow it before use.

> **⚠ The fetcher does NOT track signals.** It is deliberately deferred to a microtask so it never subscribes to anything it reads. Reactivity comes **only** from the `source` in the two-argument form:

```txt
resource(fetcher, opts?)              // runs once — nothing to re-fetch on
resource(source, fetcher, opts?)      // re-fetches whenever source() changes
```
So a one-argument `resource` whose fetcher interpolates `props.id` will fetch once and **never re-fetch when `id` changes** — a silent bug. Put every reactive input in the `source`, and read it from the fetcher's first parameter.

A `source` of `undefined`, `null`, or `false` means **"not ready"** and skips the fetch (keeping the last data and clearing `loading`) — that's the idiom for a dependent fetch: `resource(() => userId() ?? false, …)`.

The fetcher (`Fetcher<S, T>`) receives `(value, info: FetchInfo)`:

- **`info.signal`** — a fresh `AbortController`'s signal per run, aborted on the *next* run (source change, `refetch()`) and on unmount. **Pass it to `fetch`/the client or nothing is actually cancelled** — the resource ignores the superseded result either way, but the request keeps running.
- **`info.refetching`** — `true` only when this run came from a manual `refetch()`; `false` for the initial fetch and for source-driven re-fetches. Use it to show "refreshing" over stale data rather than a spinner.

Rejections land in `error()` and clear `loading()`, **except** an `AbortError` (checked by `err.name`), which is a deliberate cancel and is swallowed — neither `data` nor `error` nor `loading` is touched by the aborted run. A fetcher may return a plain value, not just a promise.

**SSR / prerender:** during a headless server render each in-flight fetch is registered with the render, so it settles before the HTML is serialized and the resumed client starts with the data already present instead of refetching. This is automatic — there is no opt-in, and in a browser it costs one `undefined` compare.

## A client (base URL, headers, interceptors)

```ts
import { createClient } from '@weave-framework/data';
export const api = createClient({
  baseUrl: '/api',
  headers: () => ({ Authorization: `Bearer ${useAuth().token()}` }), // called per request
  onError: (err) => report(err),   // observe-only hook; the error is still re-thrown
  interceptors: [auth, retry],     // first = outermost
  // fetch: myFetch,               // override the fetch impl (tests / SSR)
});
// api.get(path) / api.post(path, body) / … return typed promises; non-2xx throws HttpError
```
`ClientOptions` is exactly `{ baseUrl?, headers?, onError?, interceptors?, fetch? }`. `headers` may be a `HeadersInit` **or a function** — the function form is re-called on every request, which is how a rotating auth token stays fresh (a plain object is captured once). `onError` cannot swallow: it is called, then the error re-throws.

`Client` methods: `request<T>(method, path, opts?)`, `get<T>(path, opts?)`, `delete<T>(path, opts?)`, and `post`/`put`/`patch` as `<T>(path, body?, opts?)` — the `body` argument is sent as the JSON body. `RequestOptions` extends `RequestInit` (minus `body`/`method`) with `json` (stringified + `Content-Type: application/json` unless you already set it), `body` (raw — use for FormData/text/blobs), and `params` (a flat record appended as a query string). Pass a resource's `signal` through here: `api.get('/users', { signal })`.

The response is parsed by content type: `application/json` → `res.json()`, anything else → `res.text()`. A non-2xx throws `HttpError`, which carries `status`, `statusText` and the raw `response` (read it for a server error body). Branch on `status` (`403` → no permission, `409` → conflict).

### Interceptors

```ts
import type { Interceptor } from '@weave-framework/data';
const auth: Interceptor = async (req, next) => {
  req.headers.set('X-Trace', traceId());        // WeaveRequest is mutable — edit in place
  const res = await next(req);                   // RequestHandler: the rest of the chain
  if (res.status === 401) { await refresh(); return next(req); }
  return res;
};
```
A `WeaveRequest` is `{ url, method, headers: Headers, body, init }` — `url` is already fully resolved (baseUrl + path + query), and `headers` is a mutable `Headers` you set before calling `next`. `RequestHandler` is `(req) => Promise<Response>`; the innermost one is the real `fetch`.

Ordering: **the first interceptor in the array is outermost** — it sees the request first and the response last. The chain is composed once, at `createClient` time, so mutating `options.interceptors` later has no effect.

The chain sees the **raw `Response`, including non-2xx** — that is what makes retry-on-401 possible. The ok-check and the JSON parse happen *outside* the chain, after it returns, so an interceptor never catches `HttpError`; it inspects `res.status` itself. An interceptor may also short-circuit by returning a `Response` without calling `next` (cache hit, offline stub).

## Mutations & optimistic updates

```ts
import { action, optimistic } from '@weave-framework/data';
const save = action((patch: UserPatch) => api.patch(`/users/${id()}`, patch));
await save.run(patch);             // NOTE: .run(input) — the action object is not callable
save.pending();                    // reactive in-flight flag
save.error();                      // last rejection (cleared at the start of each run)
save.result();                     // latest resolved result
```
`action` returns an **`Action<I, T>`** — an object, not a function: call `save.run(input)`.

```txt
Action<I, T>       { run(input: I): Promise<T>, pending(): boolean,
                     error(): unknown, result(): T|undefined }
Optimistic<T, U>   { value(): T, add(update: U): void }
```
 If runs overlap only the **latest** updates the signals (a stale slow run can't clobber a newer one), while every caller still gets its own promise back — and `run` re-throws on failure, so `await` it in a `try`/`catch` if you need to react locally.

**`optimistic(base, reduce?)`** returns an **`Optimistic<T, U>`**, overlaying pending updates on a base value and reconciling automatically:
```ts
const list = optimistic(() => todos.data() ?? [], (cur, added: Todo) => [...cur, added]);
list.value();          // base with every pending update folded in — render this
list.add(newTodo);     // show it immediately
```
It exposes only `value()` and `add(u)`. There is **no explicit rollback call**: the overlay is cleared automatically the next time `base` changes (i.e. when the real data lands, whether the mutation succeeded or failed — so a failure reverts by virtue of the refetch). The default `reduce` replaces the value. Call it inside a component `setup` so its internal watcher disposes on unmount.

**So rollback is your job to trigger.** The overlay clears only when `base` *changes*; if a mutation fails and nothing re-reads the server, `base` stays put and the optimistic item stays on screen forever. Always `refetch()` (or `mutate()`) the underlying resource in a `finally`/`catch`, not just on success:

```ts
try {
  list.add(newTodo);
  await save.run(newTodo);
} finally {
  todos.refetch();   // clears the overlay whether it succeeded or failed
}
```

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
- **Forward `info.signal`** into every request the fetcher makes, or "cancellation" is only cosmetic.
- **Interceptors see raw non-2xx responses**, not `HttpError` — check `res.status`, don't try/catch inside the chain.
- A `headers` **object** in `ClientOptions` is fixed at `createClient` time; only the **function** form is re-evaluated per request, so anything that changes (an auth token) must use it.
- Prefer `@await (resource)` over manual state juggling — it wires pending/value/error for you.
- Keep the network layer in a `client`/service module, not inline in every component, so headers/interceptors/error mapping live in one place.
