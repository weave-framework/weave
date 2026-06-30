# Recipes

A grab-bag of patterns that come up in real apps. Each is small, copyable, and built only from pieces you've already met — signals, components, and the official packages.

## Fetching data

`@weave/data`'s `resource(source, fetcher)` turns an async fetch into reactive `data`/`loading`/`error` signals. It refetches whenever `source` changes and cancels the in-flight request on change or unmount — so you never hand-write loading flags or race guards:

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

`resource` also gives you `refetch()` and `mutate(value)` (write `data` directly, e.g. for a cache poke).

## A fetch client with interceptors

`createClient()` is a thin, optional wrapper over `fetch`: base URL, default headers, JSON handling, and a functional interceptor chain for auth/logging/retry — the zero-RxJS analog of Angular's `HttpInterceptorFn`. Its methods drop straight into a `resource` fetcher.

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

Interceptors run in order, wrapping `next(req)`: read or replace the request, inspect or retry the response, or short-circuit by returning a `Response` without calling `next`.

## Mutations with action

Where `resource` is for reads, `action` is for writes (submits, mutations) — it wraps an async function with reactive `pending`/`error`/`result`, and if runs overlap, only the latest updates the signals:

~~~ts
import { action } from '@weave/data';

const save = action((input: NewTask) => api.post('/tasks', input));

// in a handler:
await save.run(input);
// in the template:
// <button disabled={{ save.pending() }}>Save</button>
// @if (save.error()) { <p>…</p> }
~~~

## Optimistic UI

Two ways, depending on taste.

**By hand, in a store** — write the expected value, call the server, reconcile or roll back. This is shown in full on the [Store](/learn/store#optimistic-mutations) page and needs nothing but `signal.set`.

**Declaratively, with `optimistic`** — show an overlay value over a base while a mutation is in flight, reconciling automatically when the real base changes (the analog of React's `useOptimistic`):

~~~ts
import { optimistic } from '@weave/data';

export function setup() {
  const liked = optimistic(() => server.liked()); // base getter
  const toggle = async () => {
    liked.add(!liked.value());   // show it instantly
    await server.setLiked(!liked.value()); // base changes → overlay clears
  };
  return { liked, toggle };
}
~~~

Call `optimistic` inside a component `setup` so its internal watcher disposes on unmount.

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
  const results = resource(() => q() || false, (term) => api.get(`/search?q=${term}`));
  return { query, results };
}
~~~

~~~html
<input bind:value={{ query }} placeholder="Search…" />
@await (results) @then (rows) { <List items={{ rows }} /> }
~~~

The `|| false` makes an empty query a "not ready" source, so `resource` skips the fetch until there's something to search.

:::callout info "Keep going"
These all compose: a store full of `resource`s, an `action` behind a `form.submit`, an `ErrorBoundary` around a lazy route. When a pattern starts repeating across components, lift it into a composable. Everything is just signals underneath.
:::

[Back to the start: Introduction →](/learn/introduction) · [Reference: @weave/data →](/reference/data)
