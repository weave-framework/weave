# Recipes

A grab-bag of patterns that come up in real apps. Each is small, copyable, and built only from pieces you've already met — signals, components, and the official packages. Most of this page is the [`@weave/data`](/reference/data) surface, shown the way you'd actually reach for it.

## Fetching data

`@weave/data`'s `resource()` turns an async fetch into reactive `data`/`loading`/`error` signals. It refetches whenever its source changes and cancels the in-flight request (via an `AbortController`) on change or unmount — so you never hand-write loading flags or race guards:

~~~ts
import { resource } from '@weave/data';
import { api } from './api';

export function setup(props: { params: { id: string } }) {
  const task = resource(
    () => props.params.id,                  // source — refetch when it changes
    (id, { signal }) => api.get(`/tasks/${id}`, { signal })
  );
  return { task };
}
~~~

Render it with [`@await`](/learn/templates#await) (a refetch flips it back to pending automatically):

~~~html
@await (task) {
  <p>Loading…</p>
} @then (t) {
  <h1>{{ t.title }}</h1>
} @catch (e) {
  <p class="error">Couldn't load. {{ String(e) }}</p>
}
~~~

### The two shapes of `resource`

There are two overloads. Pick by whether the fetch depends on reactive state:

| Shape | Use it when |
| --- | --- |
| `resource(source, fetcher, opts?)` | The fetch depends on something that changes — a route param, a search term, a selected id. The resource re-runs whenever `source` changes. |
| `resource(fetcher, opts?)` | One-shot load with no reactive input (page-level data, a config blob). Under the hood the source defaults to `() => true`, so it fetches once and never re-runs on its own. You can still force a reload with `refetch()`. |

~~~ts
// Sourceless — fetches once on mount.
const config = resource(({ signal }) => api.get('/config', { signal }));

// With a source — refetches every time the id changes.
const user = resource(() => userId(), (id, { signal }) => api.get(`/users/${id}`, { signal }));
~~~

Notice the fetcher's argument shape differs: the sourceless form's fetcher gets only `(info)`, the sourced form gets `(value, info)`.

### What the source value means

The source can return a real value, or one of three "not ready" sentinels. `undefined`, `null`, and `false` are **all equivalent** — any of them tells the resource to skip the fetcher:

| Source returns | Effect |
| --- | --- |
| a real value (string, number, object, `true`, `0`, `''`…) | The fetcher runs with that value. Note `0` and `''` are *real* values, not "not ready". |
| `undefined` \| `null` \| `false` | Fetcher is skipped. `loading` is forced back to `false`, and **the last resolved `data` is kept** — going not-ready never wipes what you already had. |

This is why the debounced-search trick below maps an empty query to `false`: it parks the resource until there's something to fetch, without clearing the previous results.

### The fetcher's second argument: `{ signal, refetching }`

Every fetcher receives a `FetchInfo` as its last argument:

| Field | Meaning |
| --- | --- |
| `signal` | An `AbortSignal`. Pass it to `fetch`/your client so the in-flight request is cancelled when the source changes or the component unmounts. An aborted request is treated as an intentional cancel — it never lands in `error`. |
| `refetching` | `true` only when this run was triggered by a manual `refetch()` call; `false` for the initial load and for source-change reloads. Use it to, say, show a subtle "refreshing" spinner without blanking the page, or to skip a cache on an explicit refresh. |

~~~ts
const feed = resource(
  () => channelId(),
  async (id, { signal, refetching }) => {
    const res = await api.get(`/feed/${id}`, {
      signal,
      params: refetching ? { fresh: true } : {},   // bypass cache on manual refetch
    });
    return res;
  }
);
~~~

### The Resource object

`resource()` returns five things. They're all signals (or methods) — call them to read:

| Member | What it does |
| --- | --- |
| `data()` | The latest resolved value, or — before the first resolve — the `initialValue` you seeded (otherwise `undefined`). Reactive. |
| `loading()` | `true` while a fetch is in flight. Reactive. |
| `error()` | The last rejection, or `undefined`. **Cleared at the start of each fetch**, so a successful reload wipes a previous error. An aborted request does not set it. Reactive. |
| `refetch()` | Re-run the fetcher with the current source value, even if the source hasn't changed. The fetcher sees `refetching: true`. |
| `mutate(value)` | Set `data` directly without fetching — optimistic write or cache poke. Pass `undefined` to clear it. |

### Seeding with `initialValue`

`ResourceOptions.initialValue` is the value `data()` returns *before* the first fetch resolves — handy to render real content instead of a spinner, or to keep `@then` from flashing empty:

~~~ts
const todos = resource(
  () => listId(),
  (id, { signal }) => api.get(`/lists/${id}/todos`, { signal }),
  { initialValue: [] }   // data() is [] until the first fetch lands
);
~~~

## A fetch client with interceptors

`createClient()` is a thin, optional wrapper over `fetch`: base URL, default headers, JSON handling, an error hook, and a functional interceptor chain for auth/logging/retry — the zero-RxJS analog of Angular's `HttpInterceptorFn`. Its methods drop straight into a `resource` fetcher.

~~~ts title="data/api.ts"
import { createClient, type Interceptor } from '@weave/data';

const auth: Interceptor = (req, next) => {
  req.headers.set('Authorization', `Bearer ${token()}`);
  return next(req);
};

const log: Interceptor = async (req, next) => {
  const res = await next(req);
  console.debug(`[api] ${req.method} ${req.url} → ${res.status}`);
  return res;
};

export const api = createClient({
  baseUrl: '/api',
  interceptors: [log, auth], // first = outermost
});
~~~

### `ClientOptions`

Everything is optional — `createClient()` with no arguments is a valid bare client over the global `fetch`.

| Option | What it does |
| --- | --- |
| `baseUrl` | Prepended to every request path. Defaults to `''`. |
| `headers` | Default headers. Either a static `HeadersInit` object, **or a function called once per request** — use the function form when you need a fresh value each time, like a rotating auth token. |
| `interceptors` | A chain of `(req, next) => Promise<Response>` functions. First in the array is outermost (see below). Defaults to none. |
| `onError` | Called with any thrown error — network failure, `HttpError`, JSON parse error — *before* it is re-thrown. For logging or a global handler. It does not swallow the error; the caller still sees it. |
| `fetch` | Inject your own `fetch` implementation. Defaults to the global `fetch`. Handy for tests (a stub) or SSR (a polyfill). |

~~~ts
// Fresh token on every call — the function runs per request.
const api = createClient({
  baseUrl: '/api',
  headers: () => ({ Authorization: `Bearer ${store.token()}` }),
  onError: (e) => reportToSentry(e),
});
~~~

### How interceptors compose

Interceptors run in array order, each wrapping the `next` below it; the innermost `next` is the real `fetch`. So `[log, auth]` means `log` wraps `auth` wraps the network. Inside one you can:

- **Read or replace the request** before calling `next(req)` — mutate `req.headers` in place, rewrite `req.url`, etc.
- **Inspect or retry the response** after `await next(req)`.
- **Short-circuit** — return a `Response` *without* calling `next` at all (e.g. serve from cache, or block a request). Whatever you return becomes the response for everyone above you.

The chain hands back the raw `Response` — including non-2xx — so an interceptor can inspect or retry a failure. The ok-check and body parsing happen *outside* the chain, after it returns (see `HttpError` below).

~~~ts
// A cache interceptor that short-circuits on a hit.
const cache = new Map<string, Response>();
const cacheGet: Interceptor = async (req, next) => {
  if (req.method === 'GET' && cache.has(req.url)) {
    return cache.get(req.url)!.clone();   // never calls next — short-circuit
  }
  const res = await next(req);
  if (req.method === 'GET' && res.ok) cache.set(req.url, res.clone());
  return res;
};
~~~

### Methods and `RequestOptions`

The client exposes the usual verbs plus a generic `request`:

| Method | Notes |
| --- | --- |
| `get(path, opts?)` | — |
| `delete(path, opts?)` | — |
| `post(path, body?, opts?)` | The `body` arg is sent as `json` (auto-stringified). |
| `put(path, body?, opts?)` | Same — `body` becomes `json`. |
| `patch(path, body?, opts?)` | Same — `body` becomes `json`. |
| `request(method, path, opts?)` | The generic escape hatch — any verb, full options. The others all delegate to this. |

Each returns `Promise<T>` — generic, so `api.get<Task>('/tasks/1')` types the result.

`RequestOptions` controls a single request. It extends `RequestInit`, so anything `fetch` accepts (`signal`, `credentials`, `mode`, …) passes straight through:

| Option | What it does |
| --- | --- |
| `json` | A value to send as the body: it's `JSON.stringify`-ed and `Content-Type: application/json` is set for you (unless you already set one). This is what `post`/`put`/`patch` use under the hood. |
| `body` | A **raw** body — use this instead of `json` for `FormData`, plain text, or a `Blob`. No stringifying, no content-type guessing. |
| `params` | A `Record<string, string \| number \| boolean>` appended to the URL as a query string. Values are stringified; the `?` (or `&`) is added for you. |
| (passthrough) | `signal`, `credentials`, `mode`, and any other `RequestInit` field go through untouched. |

~~~ts
// json: stringified + content-type set
await api.post('/tasks', { title: 'Buy milk' });

// body: raw, for a file upload
const fd = new FormData();
fd.append('file', file);
await api.request('POST', '/upload', { body: fd });

// params: ?page=2&active=true
await api.get('/tasks', { params: { page: 2, active: true } });
~~~

### How responses are parsed

After the chain returns, the client checks the status and parses the body:

- **Non-2xx** → throws an `HttpError` (next section).
- **2xx with `content-type` containing `application/json`** → parsed as JSON.
- **Anything else** → returned as text.

The parsed result is what your `Promise<T>` resolves to.

### Branching on `HttpError`

A non-2xx response throws an `HttpError`. It's a real `Error` subclass carrying the details:

| Property | Value |
| --- | --- |
| `status` | The numeric status code (404, 500, …). |
| `statusText` | The status text ("Not Found"). |
| `response` | The raw `Response` object — read the error body, headers, etc. |
| `message` | `HTTP <status> <statusText>` (set for you). |

Catch it and branch on the status — in a handler, or right in an `@catch`:

~~~ts
import { HttpError } from '@weave/data';

try {
  await api.post('/tasks', input);
} catch (e) {
  if (e instanceof HttpError) {
    if (e.status === 401) redirectToLogin();
    else if (e.status === 422) showValidation(await e.response.json());
    else showToast(`Server said ${e.status}`);
  } else {
    showToast('Network down?');   // not an HttpError — a fetch/parse failure
  }
}
~~~

~~~html title="in a template"
@await (task) {
  <p>Loading…</p>
} @then (t) {
  <h1>{{ t.title }}</h1>
} @catch (e) {
  @if (e instanceof HttpError && e.status === 404) {
    <p>That task doesn't exist.</p>
  } @else {
    <p class="error">Something broke. {{ String(e) }}</p>
  }
}
~~~

## Mutations with action

Where `resource` is for reads, `action` is for writes (form submits, mutations) — the Weave analog of React's `useActionState`. It wraps an async function with reactive `pending`/`error`/`result`:

~~~ts
import { action } from '@weave/data';

const save = action((input: NewTask) => api.post('/tasks', input));

// in a handler:
const created = await save.run(input);
// in the template:
// <button disabled={{ save.pending() }}>Save</button>
// @if (save.error()) { <p>{{ String(save.error()) }}</p> }
~~~

### The Action object

| Member | What it does |
| --- | --- |
| `run(input)` | Run the action. Returns a promise that **resolves or rejects with this call's own result** — even if a newer run started after it. |
| `pending()` | `true` while a run is in flight. Reactive. |
| `error()` | The last rejection, or `undefined`. **Cleared at the start of each run.** Reactive. |
| `result()` | The latest resolved result, or `undefined`. Reactive. |

### The "only the latest run wins" rule

The reactive signals are fire-and-forget: if two runs overlap, **only the latest one updates `pending`/`error`/`result`** — a stale slow run can't clobber a fresher one's outcome. But this is only about the shared signals. **Every caller still gets its own promise back from `run`**, resolving or throwing with that exact call's result. So you can both:

- await an individual `run(...)` for that call's value, and
- read `save.pending()` / `save.error()` in the template for the *latest* state.

~~~ts
// I get THIS run's result back, even if another run finished after me.
try {
  const created = await save.run(input);
  router.go(`/tasks/${created.id}`);
} catch (e) {
  // and save.error() (the latest run's error) is also live in the template
}
~~~

The input type defaults to `void`, so an action with no input is callable as `run()`:

~~~ts
const refreshAll = action(() => api.post('/refresh'));
await refreshAll.run();   // no argument needed
~~~

## Optimistic UI

Two ways, depending on taste.

**By hand, in a store** — write the expected value, call the server, reconcile or roll back. This is shown in full on the [Store](/learn/store#optimistic-mutations) page and needs nothing but `signal.set`.

**Declaratively, with `optimistic`** — show an overlay value over a base while a mutation is in flight, reconciling automatically when the real base changes (the analog of React's `useOptimistic`). Call it inside a component `setup`, so its internal watcher disposes on unmount.

`optimistic(base, reduce?)` takes a base getter and an optional reducer:

| Member | What it does |
| --- | --- |
| `value()` | The current `base()` with **every** pending update folded in via the reducer. Reactive. |
| `add(update)` | Queue one optimistic update. It's shown immediately and cleared automatically the next time `base` changes. |

### The `reduce` reducer

`reduce(current, update)` decides how each pending update is folded onto the value. **It defaults to replace** — `(_, u) => u` — so without a reducer, `value()` is just the most recent `add`. That's enough for a toggle:

~~~ts
import { optimistic } from '@weave/data';

export function setup() {
  const liked = optimistic(() => server.liked());   // default reducer = replace
  const toggle = async () => {
    liked.add(!liked.value());        // show it instantly
    await server.setLiked(!liked.value());   // base changes → overlay clears
  };
  return { liked, toggle };
}
~~~

But a custom reducer lets pending updates **accumulate** instead of replacing — `value()` runs the reducer over *all* queued updates, in order, starting from `base()`. That's what you want for, say, optimistically appending to a list while several sends are still in flight:

~~~ts
export function setup() {
  // base = the confirmed list from the server; updates are single new messages.
  const messages = optimistic<Message[], Message>(
    () => server.messages(),
    (list, msg) => [...list, msg]      // fold each pending message onto the list
  );

  const send = async (text: string) => {
    const draft = { id: tempId(), text, pending: true };
    messages.add(draft);               // appears instantly, alongside any others still sending
    await server.send(text);           // when the server list updates, all drafts clear at once
  };

  return { messages, send };
}
~~~

Two pending `add`s here show *both* drafts at once (base + msg1 + msg2), where the default replace reducer would only ever show the last one. When `base()` next changes, the watcher drops the whole overlay in one go.

## Error boundaries

Wrap a fragile subtree in `<ErrorBoundary>`: if it throws during render — or an effect inside it throws later — the boundary swaps to your `fallback(err, reset)` instead of letting the error take down the app. `reset()` re-renders the protected content:

~~~html
<ErrorBoundary fallback={{ errorFallback }} resetKey={{ path() }}>
  <RouterView router={{ router }} />
</ErrorBoundary>
~~~

~~~ts
const errorFallback = (err: unknown, reset: () => void) => {
  const div = document.createElement('div');
  div.className = 'route-error';
  div.textContent = err instanceof Error ? err.message : String(err);
  const btn = document.createElement('button');
  btn.textContent = 'Try again';
  btn.addEventListener('click', reset);
  div.append(btn);
  return div;
};
~~~

The optional `resetKey` clears the error when it changes — `resetKey={{ path() }}` recovers automatically on navigation, without remounting the protected content.

## Composables: reuse component logic

There are no mixins or base classes — to share stateful logic, write a plain function that creates signals/effects and returns them, then call it from any `setup`:

~~~ts
function useToggle(initial = false) {
  const on = signal(initial);
  return { on, toggle: () => on.set((v) => !v), set: on.set };
}

function useLocalStorage(key: string, initial: string) {
  const value = signal(localStorage.getItem(key) ?? initial);
  effect(() => localStorage.setItem(key, value())); // persists on every change
  return value;
}

export function setup() {
  const menu = useToggle();
  const theme = useLocalStorage('theme', 'light');
  return { menu, theme };
}
~~~

Because the effects are created inside `setup`, they're owned by the component and dispose with it — a composable cleans up after itself.

## Debounced search

Keep the input instant, defer the expensive work until typing settles, with `debounced`:

~~~ts
import { signal, debounced } from '@weave/runtime';
import { resource } from '@weave/data';

export function setup() {
  const query = signal('');
  const q = debounced(query, 300);        // trails `query` by 300ms of quiet
  const results = resource(() => q() || false, (term, { signal }) => api.get(`/search?q=${term}`, { signal }));
  return { query, results };
}
~~~

~~~html
<input bind:value={{ query }} placeholder="Search…" />
@await (results) @then (rows) { <List items={{ rows }} /> }
~~~

The `|| false` makes an empty query a "not ready" source, so `resource` skips the fetch until there's something to search — and because not-ready keeps the last `data`, the old results stay on screen while you clear the box.

:::callout info "What you just learned"
- `resource` has **two shapes** — sourced (refetches on change) and sourceless (one-shot). `undefined`/`null`/`false` all mean "not ready" and keep the last data; the fetcher gets `{ signal, refetching }`; `initialValue` seeds `data()` before the first resolve.
- `action` runs writes: only the **latest** run updates the shared `pending`/`error`/`result`, but every `run(...)` call still resolves/throws with its own result.
- `optimistic`'s `reduce` defaults to replace, but a custom reducer lets pending updates **accumulate** over the base.
- `createClient` gives you `baseUrl`, static-or-function `headers`, an interceptor chain (first = outermost, can short-circuit), `onError`, and an injectable `fetch`. Non-2xx throws an `HttpError` carrying `status`/`statusText`/`response` — branch on it.
- These all compose: a store full of `resource`s, an `action` behind a `form.submit`, an `ErrorBoundary` around a lazy route. When a pattern repeats, lift it into a composable. Everything is just signals underneath.
:::

[Back to the start: Introduction →](/learn/introduction) · [Reference: @weave/data →](/reference/data)
