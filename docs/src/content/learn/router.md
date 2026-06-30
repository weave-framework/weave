# Router

`@weave/router` is the official client-side router — built in-house, signal-driven, zero third-party dependencies. The current path and query are signals, so any view that reads them updates surgically on navigation, with no reload.

## File-based routing

The easiest way to define routes is to *not* define them: drop files under a pages directory and Weave derives the routes from the filesystem. Point `routesDir` at it:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/shell',
  routesDir: 'src/pages',
});
~~~

The naming convention:

| File | Route | Notes |
|------|-------|-------|
| `index.{ts,html}` | `/` | The index |
| `stress.{ts,html}` | `/stress` | A static segment |
| `task/[id].{ts,html}` | `/task/:id` | A dynamic param |
| `[...rest].{ts,html}` | `*` | Catch-all (404) |

Each page is just a component (a `setup` + template). On `weave build`/`dev`, Weave regenerates `routes.gen.ts` from the directory, and your `router.ts` is a three-liner over it:

~~~ts title="src/app/router.ts"
import { createRouter, type Router } from '@weave/router';
import { routes } from '../pages/routes.gen';

export const router: Router = createRouter(routes);
~~~

You can also regenerate routes by hand with `weave routes src/pages`.

:::callout tip "Routes are lazy by default"
Generated routes code-split each page into its own chunk, loaded on demand. Combined with `<Link>` prefetch (below), navigation feels instant without shipping every page up front. Pass `--eager` to `weave routes` to disable splitting.
:::

## Placing views: RouterView

`<RouterView>` renders whatever route matches. Put one at the top, handing it the router:

~~~html title="shell.html"
<header>…nav…</header>
<main>
  <RouterView router={{ router }} />
</main>
~~~

For **nested layouts**, a route can have a `component` (the layout) with `children`. The layout renders a *bare* nested `<RouterView/>` (no `router` prop) — it discovers the router and its depth through context:

~~~html title="settings-layout.html"
<div class="settings">
  <nav>…sub-nav…</nav>
  <section>
    <RouterView />  <!-- the matched child renders here -->
  </section>
</div>
~~~

## Navigating: Link

`<Link>` is a client-side `<a>` — it navigates without reloading (while still letting ctrl/cmd/middle-click open a new tab the normal way):

~~~html
<Link to="/">Board</Link>
<Link to="/stress" activeClass="active">Stress</Link>
<Link to={{ '/task/' + t.id }}>Open</Link>
~~~

- **`activeClass`** adds a class when the link's target matches the current URL. Matching is prefix-by-segment, so `/users` stays active on `/users/42`; pass `exact` to require an exact match. A link to `/` is only active at exactly `/`.
- An active link also gets `aria-current="page"` automatically.
- **Prefetch is on by default** — the target's lazy chunk warms on first hover/focus. Opt out with `prefetch={{ false }}`.

For programmatic navigation, call `navigate('/path')` (or `back()`):

~~~ts
import { navigate } from '@weave/router';
const save = async () => { await store.create(input); navigate('/'); };
~~~

## Reading params and query

A matched page receives its accumulated path params on `props.params`; read the query reactively with `currentQuery()`:

~~~ts title="task/[id].ts"
import { resource } from '@weave/data';
import { api } from '../../data/api';

export function setup(props: { params: { id: string } }) {
  const id = () => props.params.id;
  // resource refetches automatically when the param changes
  const task = resource(() => props.params.id, (id) => api.get(`/tasks/${id}`));
  return { id, task };
}
~~~

Because `params` is reactive, navigating from `/task/1` to `/task/2` updates `id()` in place — the component doesn't remount, and the `resource` refetches on its own. (Want a hard reset instead? Wrap the view in [`@key (id())`](/learn/templates#key).)

## Guards and redirects

A **guard** runs synchronously during matching and may read signals. Return `true` to allow, `false` to block (falls through to the catch-all), or a path string to redirect:

~~~ts
import { isAuthed } from './auth';

const routes = [
  { path: '/dashboard', component: Dashboard,
    guard: () => isAuthed() ? true : '/login' },
  { path: '*', component: NotFound },
];
~~~

Because guards read signals, a route **re-resolves automatically** when auth state changes — log out, and a protected route redirects itself. A static `redirect: '/somewhere'` is also available for plain forwards.

:::callout info "Why sync guards?"
Async “can I enter?” checks fight lazy-loading and force the router to stall. Weave keeps guards synchronous and reactive — the auth *signal* is what gates the route — and leaves async **data** loading to the component via [`resource`](/learn/recipes#fetching-data). It's simpler and never blocks navigation.
:::

## After each navigation

Register an `afterEach` hook for document titles, analytics, or focus — it runs after every push/pop/replace and returns an unsubscribe:

~~~ts
import { afterEach, currentPath } from '@weave/router';

afterEach(({ path }) => {
  document.title = titleFor(path);
});
~~~

**Scroll is handled for you**: top-on-navigate, scroll to a `#fragment` if the URL has one, and restore position on back/forward. Manage it yourself with `setScrollHandling(false)`.

## Animating route changes

Pass a transition to the top `<RouterView>` to animate swaps. The entering view is wrapped so the intro plays even for lazy or fragment views:

~~~html
<RouterView router={{ router }} transition={{ fade }} transitionParams={{ { duration: 180 } }} />
~~~

## Code-splitting a route

Generated routes are already lazy. To lazy-load a route you define by hand, wrap it in `lazy()`:

~~~ts
import { lazy } from '@weave/runtime/dom';

const routes = [
  { path: '/reports', component: lazy(() => import('./pages/reports')) },
];
~~~

## A 404 page

The catch-all route (`*`, or the `[...rest]` file) renders when nothing else matches:

:::tabs
~~~ts title="[...rest].ts"
import { currentPath } from '@weave/router';
export function setup() {
  return { path: currentPath };
}
~~~
~~~html title="[...rest].html"
<section class="notfound">
  <h1>404</h1>
  <p>No route matches <code>{{ path() }}</code>.</p>
  <Link to="/">← Back home</Link>
</section>
~~~
:::

## Hosting under a sub-path

If your app is served from `example.com/app/` instead of the root, tell the router its base path — public paths stay root-relative, the base is stripped on read and re-added on write:

~~~ts
const router = createRouter(routes, { basename: '/app' });
~~~

:::callout info "What you just learned"
Routes come from the filesystem (`routesDir` → `index`/`name`/`[id]`/`[...rest]`). Place views with `<RouterView>` (top + nested layouts), navigate with `<Link>` (active class, prefetch) or `navigate()`. Read `props.params` reactively; guard with **sync** functions that read signals; hook `afterEach` for titles/scroll. Routes are lazy by default; animate swaps via the `transition` prop; serve under a sub-path with `basename`.
:::

[Next: Store →](/learn/store) · [Reference: @weave/router →](/reference/router)
