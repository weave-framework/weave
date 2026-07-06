# Router

`@weave-framework/router` is the official client-side router — built in-house, signal-driven, zero third-party dependencies. The current path and query are signals, so any view that reads them updates surgically on navigation, with no reload.

Routes are an ordered tree of `{ path, component?, guard?, redirect?, children? }` objects. Matching produces a *chain* of matches (layout → … → leaf); the top `<RouterView>` renders the chain's first component, and each nested `<RouterView>` renders the next, discovering its depth through context. Everything below grounds out in those two ideas.

## File-based routing

The easiest way to define routes is to *not* define them: drop files under a pages directory and Weave derives the routes from the filesystem. Point `routesDir` at it:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/shell',
  routesDir: 'src/pages',
});
~~~

A page file can be any of `.weave`, `.ts`, `.tsx`, `.js`, or `.jsx` — the file matcher recognises those five extensions (it does **not** match `.html`; an `.html` template is a *sibling* of its `.ts`/`.weave` page, not a route file on its own). The filename (minus extension) becomes a route segment:

| File | Route | Notes |
|------|-------|-------|
| `index.ts` | `''` (index) | The index child — fully-consumed path |
| `stress.ts` | `stress` | A static segment |
| `task/[id].ts` | `task/:id` | A dynamic param |
| `[...rest].ts` | `*` | Catch-all (404), honoured at the top level |

### Folders: nested vs flattened

A folder's behaviour depends on whether it contains a `_layout` file:

- **`_layout.*` present** → the folder becomes a **nested route**. The `_layout` file is its `component`, and the folder's other files become its `children`. The layout renders a nested `<RouterView/>` for them.
- **No `_layout`** → the folder is **flattened**. Each child route's path gets the folder name prefixed (`settings/profile`), and **no wrapper route** is created.

So `settings/_layout.ts` + `settings/profile.ts` yields `{ path: 'settings', component: Layout, children: [{ path: 'profile', … }] }`, whereas the same files without `_layout.ts` yield a single flat `{ path: 'settings/profile', … }`.

### Route ordering (specificity)

Generated routes are sorted so the **most specific** route wins, compared **segment by segment**: a static segment (specificity `0`) beats a `:param` (`1`), which beats a catch-all `*` (`2`). The comparison is segment-aware, not first-character — so `reference/config` sorts before `reference/:pkg` even though `:` is lexically less than `c`. Within the same specificity, segments sort alphabetically.

### Wiring it up

Each page is just a component (a `setup` + template). On `weave build`/`dev`, Weave regenerates `routes.gen.ts` from the directory, and your `router.ts` is a three-liner over it:

~~~ts title="src/app/router.ts"
import { createRouter, type Router } from '@weave-framework/router';
import { routes } from '../pages/routes.gen';

export const router: Router = createRouter(routes);
~~~

You can also regenerate routes by hand with `weave routes src/pages`.

:::callout tip "Routes are lazy by default"
Generated routes code-split each page into its own chunk, loaded on demand. Combined with `<Link>` prefetch (below), navigation feels instant without shipping every page up front. Pass `--eager` to `weave routes` to disable splitting.
:::

### The build-time API (`fileToRoutes` / `emitRoutesModule`)

The CLI scans the directory; the actual transform is two pure, zero-dep functions you can call directly (e.g. in a custom build step). They are re-exported from `@weave-framework/router`.

**`fileToRoutes(files: string[]): FileRoute[]`** maps a flat list of file specifiers (relative, slash-separated, e.g. `task/[id].ts`) to a nested manifest. A `FileRoute` is `{ path: string; file?: string; children?: FileRoute[] }` — `file` is the page's source specifier (the emitter turns it into a component import). The folder/specificity rules above are applied here.

**`emitRoutesModule(routes: FileRoute[], opts?): string`** serialises a manifest into an importable ES module that exports `const routes`. Options:

| Option | Default | Effect |
|--------|---------|--------|
| `lazy` | `false` | Code-split every page via `lazy(() => import(...))` instead of a static import |
| `runtimeImport` | `'@weave-framework/runtime/dom'` | Where `lazy` is imported from (only used when `lazy` is on) |
| `importPrefix` | `'./'` | Prefix prepended to each `file` to form the import specifier |

The emitter drops a `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` extension from import specifiers (so the import resolves under both esbuild and `tsc`) but **keeps** `.weave` (the SFC loader needs the explicit extension).

## The route shape

A hand-written `Route` is `{ path, component?, guard?, redirect?, children? }`:

| Key | Type | Meaning |
|-----|------|---------|
| `path` | `string` | `/`, `/users`, `/user/:id`, `''` (index child), or `'*'` (catch-all) |
| `component` | `Component` | What to render when matched; a layout if it also has `children` |
| `guard` | `Guard` | Sync gate run during matching (see below) |
| `redirect` | `string` | Static redirect target — resolves to this path instead of rendering |
| `children` | `Route[]` | Nested routes, matched against the path remainder under this route |

Two distinctions worth pinning down:

- **`path: ''` is the index child** — it matches when the parent's path is fully consumed. This is *not* the same as `path: '*'`, the catch-all fallback for unmatched paths.
- **There is no `meta`, `lazy`, or `name` field.** A component *can* be a `lazy()`-wrapped component (that's how code-splitting works), but `lazy` is not a route key — you wrap the component, you don't set a flag.

## Typed routes with `route()`

Plain-object routes work, but their `params` are an untyped `Record<string, string>`. The `route(path, config)` builder captures the path *literal* so `guard` and `loader` get **params inferred from the path** — `route('/user/:id', …)` gives `params.id: string`, with autocomplete and a compile error on a typo:

~~~ts
import { route } from '@weave-framework/router';

const routes = [
  route('/user/:id', {
    component: User,
    guard: (ctx) => (ctx.params.id ? true : '/'),   // ctx.params.id is typed
  }),
  { path: '*', component: NotFound },               // plain objects still work alongside
];
~~~

`route()` returns a plain `Route`, so it drops straight into the same `createRouter([...])` array and nests via `children`. Use it where you want typed params; keep plain objects where you don't.

## Route loaders

A route may declare a `loader` — data fetched when the route renders, exposed to the component (and its descendants) via `useLoaderData()`. The result is an **`@await`-compatible** `{ data, loading, error }`, so it drives `@await` directly. The loader re-runs when this route's params/query change (the previous run is aborted via `ctx.signal`):

~~~ts
route('/user/:id', {
  component: User,
  loader: ({ params, signal }) => fetch(`/api/users/${params.id}`, { signal }).then((r) => r.json()),
});
~~~

~~~html title="user.html"
@await (user()) {
  <p>Loading…</p>
} @then (u) {
  <h1>{{ u.name }}</h1>
} @catch (e) {
  <p>Failed: {{ e.message }}</p>
}
~~~

~~~ts title="user.ts"
import { useLoaderData } from '@weave-framework/router';
export function setup() {
  const user = useLoaderData<{ name: string }>();  // { data, loading, error }
  return { user };
}
~~~

> SSR note: loaders are the seam a future server render awaits and serializes into the page (see [RFC 0001](https://github.com/weave-framework/weave/blob/main/rfcs/0001-ssr-hydration.md)). Today they run on the client.

## Placing views: RouterView

`<RouterView>` renders whatever route matches at its depth. Put one at the top, handing it the router:

~~~html title="shell.html"
<header>…nav…</header>
<main>
  <RouterView router={{ router }} />
</main>
~~~

For **nested layouts**, a route has a `component` (the layout) plus `children`. The layout renders a *bare* nested `<RouterView/>` (no `router` prop) — it discovers the router and its depth through provide/inject, so there's no prop drilling:

~~~html title="settings-layout.html"
<div class="settings">
  <nav>…sub-nav…</nav>
  <section>
    <RouterView />  <!-- the matched child renders here -->
  </section>
</div>
~~~

### RouterView props

| Prop | Where | Meaning |
|------|-------|---------|
| `router` | top outlet only | The router instance. Nested outlets inject it from context instead. |
| `transition` | top outlet only | A `TransitionFn` (e.g. `fade`) that animates route swaps |
| `transitionParams` | top outlet only | Params passed to the transition (e.g. `{ duration: 180 }`) |

Behaviour you can rely on:

- **The top outlet drives URL-sync.** After a guard or static redirect, the resolved chain points somewhere other than the current URL; an internal effect *only on the top outlet* (depth 0) reads `router.redirectTo()` and calls `navigate()` to converge the address bar. Redirects always bubble to the chain root, so depth 0 is the right place.
- **Param-only changes update in place.** A stable render thunk is cached per component: navigating from `/task/1` to `/task/2` updates `params` in place (no remount); switching to a different route swaps the component.
- The outlet host is `display: contents`, so it stays layout-neutral.

## Navigating: Link

`<Link>` is a client-side `<a>` — it navigates without reloading, while still letting modifier-clicks open a new tab the normal way:

~~~html
<Link to="/">Board</Link>
<Link to="/stress" activeClass="active">Stress</Link>
<Link to={{ '/task/' + t.id }}>Open</Link>
~~~

### Link props

| Prop | Default | Meaning |
|------|---------|---------|
| `to` | `'/'` | The internal target path |
| `activeClass` | none | Class toggled on while the link is active (must be a string) |
| `exact` | `false` | Require an exact path match for active state (else prefix-by-segment) |
| `prefetch` | `true` | Warm the target's lazy chunk on first hover/focus; set `false` to opt out |

**Active state** is reactive on the current path. When the target matches, the `<a>` gets `aria-current="page"` automatically (and your `activeClass`, if named). Matching is prefix-by-segment, so a parent link (`/users`) stays active on a child (`/users/42`); pass `exact` to require an exact match. A link to `/` is only ever active at exactly `/`. The match strips any query/hash off `to` before comparing.

**Arbitrary props pass through** to the underlying `<a>`. Any prop other than the four router-owned ones above is forwarded as an attribute, so `<Link class="nav" aria-label="Home">` actually styles and labels its anchor. The pass-through rules:

- `null` / `false` / function values are skipped (so event handlers and falsy attributes don't leak through).
- `true` becomes an empty attribute (`disabled` → `disabled=""`).
- Everything else is stringified.

**`href` vs `to`.** The visible `href` is basename-prefixed (so middle/ctrl-click and SSR produce correct URLs), but navigation and active-matching use the internal `to`.

**Modifier-click bailout.** A click is intercepted and turned into in-app navigation *only* for a plain primary click. If any of these hold, the click is left alone for the browser:

| Condition | Why |
|-----------|-----|
| `ctrlKey` / `metaKey` | open in a new tab |
| `shiftKey` | open in a new window |
| `button !== 0` | a non-primary button (e.g. middle-click) |

### Programmatic navigation

~~~ts
import { navigate, back } from '@weave-framework/router';

const save = async () => { await store.create(input); navigate('/'); };
const cancel = () => back();  // go back one history entry
~~~

**`navigate(to)`** pushes a new history entry. Pass **`navigate(to, { replace: true })`** to swap the current entry instead of pushing a new one (no `<Link replace>` prop yet — call `navigate` from a click handler). What `navigate` does, in order:

1. Splits a trailing `#hash` and a `?query` out of `to`.
2. **No-op guard:** if the resulting path and search equal the current ones *and* there's no `#fragment`, it returns without touching history.
3. **Before-leave guards:** if any [`beforeEach`](#before-leaving-async-guards) guard is registered, it awaits their verdict — a `false` cancels here and nothing below runs. With no guards registered it stays fully synchronous.
4. Saves the current scroll position so back/forward can restore it (push only).
5. Writes the externally-visible URL via `history.pushState` / `history.replaceState` (basename-prefixed). If it throws (tests, sandboxes, non-navigable environments), it's swallowed — the path/search signals stay authoritative.
6. Updates the `path` and `search` signals in one batch, then fires the `afterEach` hooks.

**`back()`** simply calls `history.back()`; the `popstate` listener then syncs the signals (a `'pop'` navigation).

## Reading params and query

A matched page receives its accumulated path params on `props.params`; read the query reactively with `currentQuery()`:

~~~ts title="task/[id].ts"
import { resource } from '@weave-framework/data';
import { api } from '../../data/api';

export function setup(props: { params: { id: string } }) {
  const id = () => props.params.id;
  // resource refetches automatically when the param changes
  const task = resource(() => props.params.id, (id) => api.get(`/tasks/${id}`));
  return { id, task };
}
~~~

Because `params` is reactive, navigating from `/task/1` to `/task/2` updates `id()` in place — the component doesn't remount, and the `resource` refetches on its own. (Want a hard reset instead? Wrap the view in [`@key (id())`](/learn/templates#key).)

### Module-level reactive reads

Outside a component you can read the same signals directly:

| Export | Returns | Notes |
|--------|---------|-------|
| `currentPath()` | `string` | The current internal pathname (basename stripped). Reactive. |
| `currentQuery()` | `Record<string,string>` | Parsed query, last value wins on repeated keys. Reactive. |

Both are reactive reads — call them inside an effect/computed and they re-run on navigation.

## The Router instance

`createRouter(routes, options?)` returns a `Router` whose methods are all reactive reads — most views never touch them (they use `<RouterView>`, `props.params`, `currentQuery()`), but they're there when you need them.

| Method | Returns | Meaning |
|--------|---------|---------|
| `matched(depth = 0)` | `Match \| null` | The match at `depth` in the resolved chain (`0` = top component), or `null` |
| `chain()` | `Match[]` | The full resolved chain, layout → … → leaf |
| `params(depth?)` | `Record<string,string>` | Accumulated params at `depth`; **default is the leaf** (i.e. all params) |
| `path()` | `string` | This router's current pathname (reactive) |
| `query()` | `Record<string,string>` | The current query params (same as `currentQuery()`) |
| `navigate(to, opts?)` | `void` | Navigate this router (pushes history; `{ replace: true }` swaps the current entry). Gated by `beforeEach` guards |
| `back()` | `void` | Go back one history entry |
| `redirectTo()` | `string \| null` | The canonical pathname the URL should sync to after a guard/redirect, or `null` |
| `preload(to)` | `void` | Non-reactively resolve `to` and warm every lazy chunk in its chain |

A `Match` is `{ view: Component; params: Record<string,string> }`.

A router **owns its own signals** (path / query / navigation) — so multiple routers, isolated tests, and a future per-request SSR render each get their own URL. The module-level `navigate()` / `currentPath()` / `currentQuery()` are sugar that delegate to the active router; inside a routed component, `useRouter()` is the canonical way to reach it:

~~~ts
import { useRouter } from '@weave-framework/router';
const r = useRouter();          // injected from the enclosing <RouterView>
r.navigate('/dashboard');
~~~

`createRouter`'s options are `{ basename?, viewTransitions? }` — `basename` is equivalent to `setBasename` (see [Hosting under a sub-path](#hosting-under-a-sub-path)); `viewTransitions` is covered under [Animating route changes](#animating-route-changes).

:::callout info "Redirect-loop protection"
Resolution follows redirect and guard-redirect hops, but caps the chase at **16 hops**. If a redirect loop never settles, resolution gives up and yields an **empty chain** — a deliberate failure outcome (nothing renders) rather than an infinite spin. Design your redirects so they converge well under 16 hops.
:::

## Guards and redirects

A **guard** runs synchronously during matching and may read signals. It receives a `RouteContext` and returns `true`, `false`, or a redirect path:

~~~ts
import { isAuthed } from './auth';

const routes = [
  { path: '/dashboard', component: Dashboard,
    // ctx is { path, params, query }
    guard: (ctx) => isAuthed() ? true : `/login?from=${ctx.path}` },
  { path: '/login', component: Login },
  { path: '*', component: NotFound },
];
~~~

The `RouteContext` handed to a guard is `{ path: string; params: Record<string,string>; query: Record<string,string> }` — the resolved path, the params accumulated down to this point, and the current query. The return value:

| Return | Effect |
|--------|--------|
| `true` | Allow — render this route |
| `false` (or `null`) | **Block this branch.** Resolution aborts the current sibling and tries the next one; if none match, it falls through to the catch-all. At a nested level this aborts just that branch. |
| a `string` | Redirect to that path (re-resolved as a new hop) |

Two ordering facts:

- **A static `redirect` short-circuits before the guard.** If a matched route has a `redirect`, resolution redirects immediately and the guard never runs.
- Because guards read signals, a route **re-resolves automatically** when the signal changes — log out and a protected route redirects itself, no manual subscription needed.

:::callout info "Why sync guards?"
Async "can I enter?" checks fight lazy-loading and force the router to stall. Weave keeps guards synchronous and reactive — the auth *signal* is what gates the route — and leaves async **data** loading to the component via [`resource`](/learn/recipes#fetching-data). It's simpler and never blocks navigation.
:::

## After each navigation

Register an `afterEach` hook for document titles, analytics, or focus — it runs after every navigation and returns an unsubscribe function:

~~~ts
import { afterEach } from '@weave-framework/router';

const off = afterEach((nav) => {
  document.title = titleFor(nav.path);
});
// later: off();  // unsubscribe
~~~

The payload is the full `NavInfo`:

| Field | Type | Meaning |
|-------|------|---------|
| `path` | `string` | The internal pathname navigated to |
| `search` | `string` | The query string (including the leading `?`, or `''`) |
| `hash` | `string` | The `#fragment` (or `''`) |
| `type` | `NavType` | `'push'` (a `navigate()`), `'pop'` (back/forward), or `'replace'` |

The `type` field lets a single hook distinguish a programmatic push from a browser back/forward — useful for analytics or focus management that should behave differently on `pop`.

## Before leaving (async guards)

Route `guard`s are synchronous — great for auth, useless for *"you have unsaved changes, really leave?"*, which has to **await a user decision**. That's what **`beforeEach`** is for: a guard that runs **before every navigation commits** (push, replace, *and* browser back/forward) and can be async. Return `true` to allow, `false` to cancel and stay put.

~~~ts title="user-settings.ts"
import { beforeEach } from '@weave-framework/router';
import { onMount } from '@weave-framework/runtime';

export function setup() {
  // Register while this page is mounted; unregister on cleanup so the guard
  // only fires for *this* page. beforeEach() returns its own unregister fn.
  onMount(() =>
    beforeEach(async () => {
      if (!isDirty()) return true;               // clean → allow
      const choice = await confirmUnsaved();     // await a dialog
      if (choice === 'cancel') return false;     // stay put
      if (choice === 'save') return await save(); // save, then leave if it succeeded
      return true;                               // discard → leave
    }),
  );
  // ...
}
~~~

The guard receives a `LeaveInfo` — `{ to, from, type }` (target pathname, current pathname, and the `NavType`) — so it can key off *where* you're going. Semantics:

| Aspect | Behavior |
|--------|----------|
| **Async** | Return a `Promise<boolean>`; the router awaits it before committing. Nothing navigates while it's pending. |
| **Cancel** | `false` (or `Promise<false>`) → the navigation does not happen; `currentPath()` and the address bar stay on the old path. |
| **Back/forward** | On a cancelled `pop` the router rolls history back (`history.go`) so the URL matches staying put — no "content old, address new" half-state. |
| **Multiple guards** | All registered guards must return `true`; the **first `false` short-circuits** (later guards don't run). |
| **Unregister** | `beforeEach(fn)` returns an unregister function — call it in cleanup (e.g. `onMount`'s return) so the guard lives only while the page is mounted. |
| **Ordering** | Before-leave runs **earlier** than the target route's matching/`guard`. If it cancels, matching never runs and `afterEach` does not fire. |

:::callout info "beforeEach vs guard"
`guard` answers *"can I enter this route?"* synchronously from signals. `beforeEach` answers *"may I leave the current page?"* and can await. They're complementary — a page can have both. `beforeEach` covers **in-app** navigation only; for browser reload / tab-close use a `beforeunload` listener (a different layer the browser owns).
:::

## Scroll handling

Built-in scroll management is **on by default in the browser**. `setScrollHandling(on: boolean)` toggles it:

- On a **`pop`** (back/forward), it restores the saved scroll position for that history entry.
- On a **push with a `#hash`**, it scrolls the matching element into view if found, otherwise scrolls to the top.
- On a plain push, it scrolls to the top.

~~~ts
import { setScrollHandling } from '@weave-framework/router';

setScrollHandling(false);  // take over scroll yourself
~~~

Weave also sets `history.scrollRestoration = 'manual'` so the browser's native restoration doesn't fight its own.

## Prefetching

Lazy route chunks can be warmed ahead of navigation so the swap is instant:

- **`router.preload(to)`** — resolve `to` against *this* router (non-reactively) and warm every lazy chunk in its chain.
- **`prefetch(to)`** — a module-level helper that targets the **most recently created** router. This is what `<Link prefetch>` calls under the hood (on hover/focus). It's a no-op if no router exists or the chain isn't lazy.

~~~ts
import { prefetch } from '@weave-framework/router';

prefetch('/reports');  // warm the most-recent router's /reports chunk
~~~

## Animating route changes

Pass a transition to the top `<RouterView>` to animate swaps. The entering view is wrapped in a real element so the intro plays even for lazy or fragment views:

~~~html
<RouterView router={{ router }} transition={{ fade }} transitionParams={{ { duration: 180 } }} />
~~~

`transition`/`transitionParams` are honoured on the **top outlet only** — nested outlets don't run their own transition. Author a page-root `out:` if you also want a leave animation.

### Native View Transitions

For a browser-native cross-fade of the whole page, opt in with `viewTransitions: true`. On navigation the router wraps the DOM swap in `document.startViewTransition()`; because Weave's updates are synchronous, the outlet swaps *inside* the transition callback and the browser animates between the before/after snapshots:

~~~ts
const router = createRouter(routes, { viewTransitions: true });
~~~

It's a progressive enhancement: browsers without the API fall back to a plain swap, and any `transition` prop on `<RouterView>` still plays. Style the animation with the standard `::view-transition-*` pseudo-elements in your CSS.

## Code-splitting a route

Generated routes are already lazy. To lazy-load a route you define by hand, wrap the *component* in `lazy()` (remember: `lazy` is not a route key):

~~~ts
import { lazy } from '@weave-framework/runtime/dom';

const routes = [
  { path: '/reports', component: lazy(() => import('./pages/reports')) },
];
~~~

## A 404 page

The catch-all route (`path: '*'`, or the `[...rest]` file) renders when nothing else matches:

:::tabs
~~~ts title="[...rest].ts"
import { currentPath } from '@weave-framework/router';
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

If your app is served from `example.com/app/` instead of the root, tell the router its base path. Public paths (route patterns, `navigate()`, `<Link to>`, `currentPath()`) stay root-relative; the base is stripped when reading `location` and re-added when writing history.

Two equivalent ways to set it:

~~~ts
import { createRouter, setBasename } from '@weave-framework/router';

// (a) as a createRouter option
const router = createRouter(routes, { basename: '/app' });

// (b) standalone — call ONCE before the first render
setBasename('/app');
~~~

`setBasename(base)` normalises the base (a trailing slash is stripped; `''` and `'/'` both mean "no base") and resyncs the path signal from the current location. Use the standalone form when you set the base outside of `createRouter`; otherwise the option is the convenient path.

## Types reference

All exported from `@weave-framework/router`:

| Type | Shape |
|------|-------|
| `Route` | `{ path; component?; guard?; redirect?; children? }` |
| `Guard` | `(ctx: RouteContext) => boolean \| string` |
| `RouteContext` | `{ path: string; params; query }` |
| `RouteParams` | `Record<string, string>` |
| `Match` | `{ view: Component; params: RouteParams }` |
| `Router` | the instance (see [The Router instance](#the-router-instance)) |
| `NavType` | `'push' \| 'pop' \| 'replace'` |
| `NavInfo` | `{ path; search; hash; type }` |
| `NavigateOptions` | `{ replace?: boolean }` |
| `LeaveGuard` | `(nav: LeaveInfo) => boolean \| Promise<boolean>` |
| `LeaveInfo` | `{ to: string; from: string; type: NavType }` |
| `FileRoute` | `{ path: string; file?: string; children? }` |
| `EmitRoutesOptions` | `{ lazy?; runtimeImport?; importPrefix? }` |

:::callout info "What you just learned"
Routes are an ordered tree of `{ path, component?, guard?, redirect?, children? }`, or come from the filesystem (page files are `.weave`/`.ts`/`.tsx`/`.js`/`.jsx`; `_layout` nests a folder, no-layout flattens it; routes sort by per-segment specificity). Place views with `<RouterView>` (top outlet drives URL-sync and transitions; nested outlets inject the router). Navigate with `<Link>` (active class, arbitrary prop pass-through, modifier-click bailout, basename-prefixed `href`) or `navigate()`/`navigate(to, { replace: true })`/`back()`. Guards are sync, receive a `RouteContext`, and return `true`/`false`/a path; a static `redirect` short-circuits before the guard; redirects are capped at 16 hops (an empty chain on a loop). Await a leave decision (unsaved-changes prompts) with `beforeEach` — async, cancellable, covers push/replace/back. The `Router` instance exposes `matched`/`chain`/`params`/`query`/`redirectTo`/`preload`; hook `afterEach` for the full `NavInfo`; prefetch via `<Link>`, `prefetch()`, or `router.preload()`; control scroll with `setScrollHandling`; serve under a sub-path with `basename`/`setBasename`.
:::

[Next: Store →](/learn/store) · [Reference: @weave-framework/router →](/reference/router)
