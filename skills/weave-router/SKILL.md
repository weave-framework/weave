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
Matching produces a **chain** of `Match` (layout → … → leaf). The top `<RouterView router={r}/>` renders depth 0; each nested `<RouterView/>` (inside a layout) renders the next, discovering the router via context. `route('/:id', …)` is the typed builder — `params.id` is typed from the path literal; plain objects work too (untyped params).

```txt
route<Path>(path: Path, config?: RouteConfig<Path>): Route
RouteConfig<Path> = { component?, guard?, loader?, redirect?, children? }  // Route minus `path`
RouteParamsOf<'/user/:id/post/:pid'> = { id: string; pid: string }   // param-less path → {}
RouteParams = Record<string, string>          // params AND query are always string maps
Match = { view: Component; params: RouteParams; loader? }
```
Matching is segment-by-segment; the **first matching sibling wins**, and a sibling only matches if a child consumes the whole remainder (otherwise the next sibling is tried). Params accumulate down the chain, so a leaf's `params` includes the layout's. Param values are `decodeURIComponent`'d.

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
`NavigateOptions` is just `{ replace?: boolean }`. The module-level `navigate` / `currentPath` / `currentQuery` act on the **most recently created router**; with more than one router, call the methods on the instance instead. `back()` is `history.back()` — global either way, including `router.back()`. A bare `#fragment` target keeps the current path + query (it only scrolls); an otherwise-identical navigation with no hash is a no-op.

## Params & query in a component

```ts
import { useRouter } from '@weave-framework/router';
export function setup(props: { params: { id: string } }) {
  const id = () => props.params.id;      // params passed to the routed component
  const r = useRouter();                 // or reach the router from context
  const tab = () => r.query().tab ?? 'overview';
}
```
The routed component receives `params` as a prop (reactive getter). `useRouter()` returns the `Router` — it **throws** outside a `<RouterView>` subtree (use the module-level sugar there):

```txt
Router = {
  matched(depth = 0): Match | null      // the match at that depth, or null
  chain(): Match[]                      // layout → … → leaf
  params(depth?): RouteParams           // DEFAULT = the leaf (all accumulated params)
  path(): string; query(): RouteParams  // reactive, this router's own
  navigate(to, opts?: NavigateOptions): void
  back(): void
  redirectTo(): string | null           // path the URL must sync to after a guard/redirect
  preload(to: string): void             // warm that path's lazy chunks (what Link prefetch calls)
}
```
Only the **top** outlet acts on `redirectTo()` — don't wire it yourself.

## Guards & redirects

- **Route `guard`** — synchronous; reads signals; return `true` (allow), `false` (block → fallback), or a **path string** (redirect). Because it reads signals, the route re-resolves automatically when auth changes.
- **Static `redirect`** — `{ path: '/old', redirect: '/new' }`.
- **`beforeEach(fn)`** — an **async** before-leave guard (return `boolean | Promise<boolean>`); the place for an "unsaved changes?" dialog. Register in a component and unregister on cleanup.
- **`afterEach(fn)`** — runs after every navigation (title, analytics, focus). Both return an unsubscribe function.

```txt
type Guard      = (ctx: RouteContext) => boolean | string
type RouteContext = { path: string; params: RouteParams; query: RouteParams }
type NavType    = 'push' | 'pop' | 'replace'
type LeaveGuard = (nav: LeaveInfo) => boolean | Promise<boolean>
type LeaveInfo  = { to: string; from: string; type: NavType }   // pathnames only, no query/hash
type NavInfo    = { path: string; search: string; hash: string; type: NavType }  // → afterEach
```
```ts
import { beforeEach, afterEach } from '@weave-framework/router';
export function setup() {
  onMount(() => onCleanup(beforeEach(async ({ to }) => (dirty() ? await confirmLeave(to) : true))));
  onMount(() => onCleanup(afterEach((nav) => { document.title = titleFor(nav.path); })));
}
```
What goes wrong:
- `redirect` **wins over `guard`** — a route carrying both never runs its guard.
- A guard returning `false` blocks the whole level and falls through to the **catch-all**; it does *not* try the next sibling. Prefer returning a redirect path.
- `beforeEach` hooks live in one **module-global** set shared by every router, run in registration order, and the first `false` short-circuits the rest. Forgetting to unregister leaves a guard vetoing navigations after its page is gone.
- On **back/forward** the browser has already moved the URL before the guard runs; a veto rolls it back with `history.go(±1)`, so the address bar flickers to the target and back. That is expected.
- Redirect hops are capped at **16** — a redirect loop yields an empty chain (blank outlet), not a hang.

## Route loaders (data)

A route may declare a `loader(ctx)` (typed params + an `AbortSignal`). Read it in the component with `useLoaderData()`, which returns an `@await`-compatible `{ data, loading, error }`:

```ts
route('/user/:id', { component: UserPage, loader: ({ params, signal }) => fetchUser(params.id, signal) });
```
```html
@await (useLoaderData()) { <Spinner /> } @then (user) { <Profile user={{ user }} /> } @catch (e) { <Alert /> }
```
```txt
LoaderContext<P> = { params: P; query: RouteParams; signal: AbortSignal }
LoaderData<T>    = { data(): T | undefined; loading(): boolean; error(): unknown }   // all reactive
```
Re-run key = this depth's `params` + the **whole query**, JSON-compared: a param-only change at another depth doesn't refetch, but *any* query change re-runs every loader in the chain. Each re-run aborts the previous `signal` and ignores its late settle; `error` is cleared at the start of each run; `loading` starts `true`. `useLoaderData()` **throws** if the current route declares no `loader`. For general in-component fetching, see **weave-data**.

## Lazy routes

Point a route's `component` at a lazily-loaded component so its code splits into its own chunk; `<Link>` prefetches it on hover, or call `prefetch('/path')`. (See the `lazy()` runtime helper.)

## Config

- `createRouter(routes, { basename, viewTransitions })` — `basename` hosts the app under a sub-path (GitHub Pages); `viewTransitions: true` wraps swaps in the View Transitions API.
- `setBasename('/weave')` — the same thing standalone, for when you don't own the `createRouter` call. It is **module-global** (not per-router) and must run before the first render. Everything you write stays *internal* — route patterns, `<Link to>`, `navigate()`, `currentPath()` — the prefix appears only in the address bar and the rendered `href`. Writing the prefix into a route path or a `to` is the classic basename bug: it gets prefixed twice and never matches.
- `setServerLocation('/users/42?tab=x')` — seed the location for a headless SSR/SSG render, where there is no `window.location`. It seeds routers created afterwards *and* updates an already-created active one. In a browser it changes nothing (real `location` wins), so it is safe in shared entry code. Pass the internal path; basename is applied as when reading `location`.
- `setScrollHandling(false)` to manage scroll yourself (default: top-on-push, `#fragment`, restore-on-pop).
- **File-based routes**: `fileToRoutes(files: string[]): FileRoute[]` maps page specifiers to a manifest (`{ path, file?, children? }`), and `emitRoutesModule(routes, opts?: EmitRoutesOptions)` serialises it to a module exporting `const routes`. `EmitRoutesOptions = { lazy?, runtimeImport?, importPrefix? }` — `lazy: true` emits `lazy(() => import(...))` per page. Conventions: `index.*` → `''`, `[id].*` → `':id'`, `[...rest].*` → `'*'`, `_layout.*` makes its folder a nested route, a folder without one is flattened into prefixed paths; siblings sort static → `:param` → `*`. Both are pure string work — the CLI (`routes.gen`, see weave-tooling) supplies the directory scan.

## Gotchas

- The **top** `<RouterView>` needs `router={{ … }}`; **nested** ones take none (they read context).
- Guards are **sync** (they read signals and re-resolve reactively). Async *data* belongs in a loader or `@weave-framework/data`, not a guard. Async *leave* prompts use `beforeEach`.
- `'*'` is the catch-all — put it last.
- `params` reach the component as a **prop**; read `props.params.x` reactively (don't destructure).
- A **param-only** change (`/user/1` → `/user/2`) updates `params` in place — the component is *not* remounted, so `onMount` does not re-run. Put per-param work in an `effect`/`loader`, not `onMount`.
- Params and query are always **strings** (`RouteParams`) — parse numbers yourself.
