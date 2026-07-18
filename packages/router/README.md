# @weave-framework/router

Weave's official client router — signal-driven, history-based, with `RouterView` + `Link`. Zero third-party deps.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/router
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## Usage

Routes are an ordered tree of `{ path, component?, guard?, redirect?, loader?, children? }`. The current path and query are signals, so anything that reads them updates surgically on navigation.

```ts
import { createRouter, route } from '@weave-framework/router';
import Home from './pages/home.js';
import User from './pages/user.js';
import NotFound from './pages/not-found.js';

export const router = createRouter([
  { path: '/', component: Home },
  route('/user/:id', {
    component: User,
    loader: ({ params, signal }) => fetch(`/api/users/${params.id}`, { signal }).then((r) => r.json()),
  }),
  { path: '*', component: NotFound }, // catch-all fallback
]);
```

Place the output with a top-level outlet, and a nested `<RouterView/>` inside each layout component:

```html
<RouterView router={{ router }} />
<Link to="/user/42" activeClass="active">Profile</Link>
```

`route()` is the opt-in typed builder: it captures the path *literal*, so `guard` and `loader` receive `params` inferred from it (`/user/:id` → `params.id: string`). Plain objects work too, with untyped params.

## Inside a routed component

```ts
import { useRouter, useLoaderData } from '@weave-framework/router';

const r = useRouter();
r.params();          // accumulated path params, reactive
r.navigate('/home'); // push; { replace: true } to swap the entry

const { data, loading, error } = useLoaderData(); // drives `@await` directly
```

## What else is in the box

- **Guards** — `guard` is synchronous and reads signals (`isAuthed()`), so a route re-resolves when auth changes. Return `true`, `false`, or a path to redirect.
- **Leave guards** — `beforeEach(fn)` runs *before* a navigation commits and may be async, for "unsaved changes" prompts. Returns an unregister function.
- **Navigation hooks** — `afterEach(fn)` for titles, analytics, focus.
- **Nested routes** — a parent layout renders a nested `<RouterView/>`, which finds its router and depth through context.
- **Scroll handling** — top-on-push, `#fragment`, restore-on-back, on by default (`setScrollHandling(false)` to opt out).
- **Sub-path hosting** — `createRouter(routes, { basename: '/docs' })`, or `setBasename`.
- **View Transitions** — `createRouter(routes, { viewTransitions: true })` wraps navigations in `document.startViewTransition` where supported.
- **Prefetch** — `<Link>` warms a lazy route's chunk on hover/focus (`prefetch={{ false }}` to disable).
- **File-based routing** — `fileToRoutes` / `emitRoutesModule` from `@weave-framework/router/files`, driven by the CLI's `routesDir`.

📚 **Guides + full API reference:** [Router guide](https://weaveframework.dev/learn/router) · [API reference](https://weaveframework.dev/reference/router)

## License

MIT
