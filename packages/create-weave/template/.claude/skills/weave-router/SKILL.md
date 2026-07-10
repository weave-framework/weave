---
name: weave-router
description: >-
  Client-side routing in a Weave app with @weave-framework/router. Use this
  whenever you set up navigation, routes, or route-driven UI: `createRouter`,
  `route()`, `<RouterView>`, `<Link>`, `navigate`, path params (`/user/:id`),
  query, guards (auth/redirects), nested/layout routes, lazy routes, route
  loaders, or "unsaved changes" leave guards. Reach for it on any mention of
  routing, navigation, URL/path, pages/screens wiring, or a 404 fallback — even if
  the user just says "add a page" or "protect this route".
---

# Weave router

`@weave-framework/router` is the built-in, signal-driven, history-based router
(zero third-party deps). The current path/query are signals, so any view that reads
them updates surgically on navigation. Routes are an ordered tree of `{ path,
component?, guard?, redirect?, loader?, children? }`.

## Define routes + place the outlet

```ts
import { createRouter, route } from '@weave-framework/router';
import Home from './pages/home';
import UserPage from './pages/user';
import Shell from './layout/shell';

export const router = createRouter([
  { path: '/', component: Home },
  {
    path: '/users', component: Shell, children: [   // layout with a nested outlet
      { path: '', component: UsersList },           // index child
      route('/:id', { component: UserPage,          // typed params via route()
        guard: ({ params }) => isAuthed() || '/login' }),
    ],
  },
  { path: '*', component: NotFound },               // catch-all (404)
]);
```
```html
<!-- app.html: the top outlet -->
<RouterView router={{ router }} />
<!-- shell.html: a nested outlet renders the next match in the chain -->
<nav>…</nav>
<RouterView />
```
Matching produces a **chain** (layout → … → leaf). The top `<RouterView router={r}/>` renders depth 0; each nested `<RouterView/>` (inside a layout) renders the next, discovering the router via context. `route('/:id', …)` is the typed builder — `params.id` is typed from the path literal; plain objects work too (untyped params).

## Links & navigation

```html
<Link to="/users/42" activeClass="active">User 42</Link>
```
`<Link>` navigates on plain click (ctrl/cmd/middle-click still open a new tab), sets `aria-current="page"` when active, and prefetches lazy chunks on hover/focus. Matching is prefix-by-segment (a parent link stays active on children); pass `exact` for exact-only.

Programmatic:
```ts
import { navigate, back, currentPath, currentQuery } from '@weave-framework/router';
navigate('/users/42');
navigate('/login', { replace: true });
back();
currentPath();   // reactive current pathname
currentQuery();  // reactive { key: value } query map
```

## Params & query in a component

```ts
import { useRouter } from '@weave-framework/router';
export function setup(props: { params: { id: string } }) {
  const id = () => props.params.id;      // params passed to the routed component
  const r = useRouter();                 // or reach the router from context
  const tab = () => r.query().tab ?? 'overview';
}
```
The routed component receives `params` as a prop (reactive). `useRouter()` (within a `<RouterView>` subtree) gives `{ navigate, back, path, query, params, matched, chain }`.

## Guards & redirects

- **Route `guard`** — synchronous; reads signals; return `true` (allow), `false` (block → fallback), or a **path string** (redirect). Because it reads signals, the route re-resolves automatically when auth changes.
- **Static `redirect`** — `{ path: '/old', redirect: '/new' }`.
- **`beforeEach(fn)`** — an **async** before-leave guard (return `boolean | Promise<boolean>`); the place for an "unsaved changes?" dialog. Register in a component and unregister on cleanup.
- **`afterEach(fn)`** — runs after every navigation (title, analytics, focus).

```ts
import { beforeEach } from '@weave-framework/router';
export function setup() {
  onMount(() => onCleanup(beforeEach(async () => dirty() ? await confirmLeave() : true)));
}
```

## Route loaders (data)

A route may declare a `loader(ctx)` (typed params + an `AbortSignal`). Read it in the component with `useLoaderData()`, which returns an `@await`-compatible `{ data, loading, error }`:

```ts
route('/user/:id', { component: UserPage, loader: ({ params, signal }) => fetchUser(params.id, signal) });
```
```html
@await (useLoaderData()) { <Spinner /> } @then (user) { <Profile user={{ user }} /> } @catch (e) { <Alert /> }
```
The loader re-runs when this route's params/query change (aborting the previous run). For general in-component fetching, see **weave-data**.

## Lazy routes

Point a route's `component` at a lazily-loaded component so its code splits into its own chunk; `<Link>` prefetches it on hover, or call `prefetch('/path')`. (See the `lazy()` runtime helper.)

## Config

- `createRouter(routes, { basename, viewTransitions })` — `basename` hosts the app under a sub-path (GitHub Pages); `viewTransitions: true` wraps swaps in the View Transitions API.
- `setScrollHandling(false)` to manage scroll yourself (default: top-on-push, `#fragment`, restore-on-pop).
- **File-based routes**: `fileToRoutes` / `emitRoutesModule` generate a routes module from a pages directory (the CLI's `routes.gen` — see weave-tooling).

## Gotchas

- The **top** `<RouterView>` needs `router={{ … }}`; **nested** ones take none (they read context).
- Guards are **sync** (they read signals and re-resolve reactively). Async *data* belongs in a loader or `@weave-framework/data`, not a guard. Async *leave* prompts use `beforeEach`.
- `'*'` is the catch-all — put it last.
- `params` reach the component as a **prop**; read `props.params.x` reactively (don't destructure).
