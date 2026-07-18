# @weave-framework/data

Weave data — signal-native async resources + a tiny fetch client. Zero third-party deps.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/data
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## Resources

A `resource` turns an async fetcher into reactive `{ data, loading, error }` — plus `refetch` and `mutate`. Drive it from a reactive source and it re-fetches when that source changes, aborting the previous request.

```ts
import { resource } from '@weave-framework/data';

// Standalone: fetch once.
const users = resource(async (_, { signal }) => {
  const res = await fetch('/api/users', { signal });
  return res.json();
});

// Source-driven: re-fetches whenever `userId()` changes.
const user = resource(
  () => userId(),
  async (id, { signal }) => (await fetch(`/api/users/${id}`, { signal })).json()
);

user.loading(); // reactive
user.data();    // reactive — undefined until the first fetch resolves
user.error();   // reactive
user.refetch();
```

A source of `undefined`, `null`, or `false` means "not ready" and skips the fetch. Pass `{ initialValue }` to seed `data()` before the first resolve. The shape is `@await`-compatible, so `@await (user)` renders pending / value / error branches straight from a template.

## The client

`createClient` gives you `get` / `post` / `put` / `patch` / `delete` (and a generic `request`) over a shared config. Its methods are ready-made resource fetchers.

```ts
import { createClient, HttpError } from '@weave-framework/data';

const api = createClient({
  baseUrl: '/api',
  headers: () => ({ Authorization: `Bearer ${token()}` }), // called per request
});

await api.get('/users', { params: { page: 2 } });
await api.post('/users', { name: 'Ada' }); // JSON body + Content-Type set for you
```

A non-2xx response throws an `HttpError` carrying `status`, `statusText`, and the raw `Response`. `interceptors` is a functional chain — each gets `(req, next)` and may read or replace the request, inspect or retry the response, or short-circuit without calling `next`. The first interceptor is outermost.

## Mutations

`action` wraps a mutation with reactive `pending` / `error` / `result`. Overlapping runs are safe — only the latest updates the signals, while every caller still gets its own promise back.

```ts
import { action } from '@weave-framework/data';

const save = action((values: Draft) => api.post('/posts', values));

await save.run(draft);
save.pending(); // reactive
save.error();   // reactive
```

`optimistic(base, reduce?)` layers in-flight updates over a base value and clears them automatically once `base` next changes. Call it inside an owner (a component's `setup`) so its watcher disposes on unmount.

📚 **Guides + full API reference:** [Recipes](https://weaveframework.dev/learn/recipes) · [API reference](https://weaveframework.dev/reference/data)

## License

MIT
