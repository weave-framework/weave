/**
 * @weave/router — the official client router. Built in, not a third-party bolt-on.
 * Zero third-party dependencies (only `@weave/runtime`).
 *
 * History-based and signal-driven: the current path and query are signals, so any
 * view that reads them updates surgically on navigation. Routes are an ordered array
 * of `{ path, component, guard?, redirect? }` objects (`'*'` = catch-all fallback),
 * supporting path params (`/user/:id`), query parsing (`?tab=x`), **sync guards**
 * (read auth signals; return `true`/`false`/a redirect path), and static `redirect`s.
 * The Angular-flavored surface is a `<RouterView>` outlet + `<Link>`.
 *
 * Guards are synchronous by design: they run inside the reactive `matched` computation
 * and read signals (e.g. `isAuthed()`), so a route re-resolves automatically when the
 * auth state changes. Async data loading belongs in the component via `@weave/data`.
 */

import { signal, computed, effect, batch } from '@weave/runtime';
import { ifBlock, type Component } from '@weave/runtime/dom';

export type RouteParams = Record<string, string>;

/** Context handed to a guard: the resolved path, its path params, and parsed query. */
export interface RouteContext {
  path: string;
  params: RouteParams;
  query: RouteParams;
}

/**
 * A route guard. Runs synchronously during matching and may read signals.
 * Return `true` to allow, `false` to block (→ fallback), or a path string to redirect.
 */
export type Guard = (ctx: RouteContext) => boolean | string;

/** A single route definition. `path: '*'` is the catch-all (404) fallback. */
export interface Route {
  /** Path pattern: `/`, `/user/:id`, or `'*'` (catch-all fallback). */
  path: string;
  /** Component to render when matched. Omit when using `redirect`. */
  component?: Component;
  /** Sync guard: `true` allows, `false` blocks (→ fallback), a string redirects. */
  guard?: Guard;
  /** Static redirect target (pathname). When matched, resolve to this path instead. */
  redirect?: string;
}

const path = signal(typeof location !== 'undefined' ? location.pathname : '/');
const search = signal(typeof location !== 'undefined' ? location.search : '');

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    batch(() => {
      path.set(location.pathname);
      search.set(location.search);
    });
  });
}

/** The reactive current pathname (read-only). */
export const currentPath = (): string => path();

/** Parsed query string as a reactive `{ key: value }` map (last value wins on repeats). */
const queryMap = computed<RouteParams>(() => {
  const out: RouteParams = {};
  const s = search();
  if (s) new URLSearchParams(s).forEach((v, k) => (out[k] = v));
  return out;
});

/** The reactive current query params (read-only). */
export const currentQuery = (): RouteParams => queryMap();

/** Programmatic navigation (pushes history). Resilient if the env blocks pushState. */
export function navigate(to: string): void {
  const noHash = to.split('#')[0];
  const qI = noHash.indexOf('?');
  const nextPath = qI === -1 ? noHash : noHash.slice(0, qI);
  const nextSearch = qI === -1 ? '' : noHash.slice(qI);
  if (nextPath === path.peek() && nextSearch === search.peek()) return;
  try {
    history.pushState(null, '', to);
  } catch {
    /* non-navigable environment (tests, sandboxes) — the signals stay authoritative */
  }
  batch(() => {
    path.set(nextPath);
    search.set(nextSearch);
  });
}

/** Go back one history entry (the `popstate` listener syncs the path). */
export function back(): void {
  history.back();
}

type Matcher = (p: string) => RouteParams | null;

/** Compile `/user/:id` into a matcher returning its params, or null on no match. */
function compileRoute(pattern: string): Matcher {
  const keys: string[] = [];
  const re = new RegExp(
    '^' +
      pattern
        .replace(/\/+$/, '')
        .replace(/:[^/]+/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        })
        .replace(/\//g, '\\/') +
      '\\/?$'
  );
  return (p) => {
    const m = re.exec(p.replace(/\/+$/, '') || '/');
    if (!m) return null;
    const params: RouteParams = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return params;
  };
}

/** A reactive match: the winning component + its path params, or null. */
export interface Match {
  view: Component;
  params: RouteParams;
}

export interface Router {
  /** The currently matched route (component + params) after guards/redirects, or null. */
  matched: () => Match | null;
  /** The current path params (reactive; `{}` when unmatched). */
  params: () => RouteParams;
  /** The current query params (reactive). */
  query: () => RouteParams;
  /**
   * Canonical pathname the URL should be synced to (set when a guard/redirect moved the
   * match elsewhere), or null. `RouterView` consumes this to push history; surfaced so
   * a custom outlet can too.
   */
  redirectTo: () => string | null;
}

/**
 * Build a router from an ordered `Route[]` (`path: '*'` = catch-all fallback).
 * Resolution (a single reactive computation): walk routes in order; on the first match,
 * follow a static `redirect`, run the `guard` (allow / block→fallback / redirect string),
 * else render the component. Redirect hops are capped to break loops. Place the output
 * with `<RouterView router={r}/>`.
 */
export function createRouter(routes: Route[]): Router {
  const compiled = routes
    .filter((r) => r.path !== '*')
    .map((r) => ({ route: r, match: compileRoute(r.path) }));
  const fallback = routes.find((r) => r.path === '*');
  const fallbackMatch = (): Match | null =>
    fallback?.component ? { view: fallback.component, params: {} } : null;

  const resolution = computed<{ match: Match | null; redirectTo: string | null }>(() => {
    const q = queryMap();
    const start = path();
    let p = start;
    for (let hops = 0; hops < 16; hops++) {
      let chosen: { route: Route; match: Matcher } | null = null;
      let params: RouteParams | null = null;
      for (const c of compiled) {
        const pr = c.match(p);
        if (pr) {
          chosen = c;
          params = pr;
          break;
        }
      }
      const synced = p !== start ? p : null;
      if (!chosen) return { match: fallbackMatch(), redirectTo: synced };
      if (chosen.route.redirect) {
        p = chosen.route.redirect;
        continue;
      }
      const verdict = chosen.route.guard
        ? chosen.route.guard({ path: p, params: params!, query: q })
        : true;
      if (verdict === false) return { match: fallbackMatch(), redirectTo: synced };
      if (typeof verdict === 'string') {
        p = verdict;
        continue;
      }
      return { match: { view: chosen.route.component!, params: params! }, redirectTo: synced };
    }
    // Redirect loop: give up rather than spin.
    return { match: null, redirectTo: null };
  });

  return {
    matched: () => resolution().match,
    params: () => resolution().match?.params ?? {},
    query: () => queryMap(),
    redirectTo: () => resolution().redirectTo,
  };
}

/**
 * Router outlet: renders the matched component reactively. A `display:contents`
 * host keeps it layout-neutral. A stable render thunk per component means a
 * param-only change (`/user/1` → `/user/2`) updates `params` in place instead of
 * remounting; switching to a different route swaps the component. When a guard or
 * redirect moves the match elsewhere, a scoped effect syncs the address bar.
 *
 * Usage in a template: `<RouterView router={r}/>`.
 */
export const RouterView: Component = (props = {}) => {
  const router = (props as { router?: Router }).router;
  const host = document.createElement('div');
  host.style.display = 'contents';
  const anchorNode = document.createComment('router');
  host.appendChild(anchorNode);

  // Sync the URL when a guard/redirect resolved the match to a different path.
  // Owned by this outlet's scope (disposed with it). Converges: after navigate the
  // resolution lands on the target, so redirectTo() returns null and this no-ops.
  if (router) {
    effect(() => {
      const to = router.redirectTo();
      if (to !== null && to !== path.peek()) navigate(to);
    });
  }

  const thunks = new Map<Component, () => Node>();
  ifBlock(anchorNode, () => {
    const m = router?.matched() ?? null;
    if (!m) return null;
    let thunk = thunks.get(m.view);
    if (!thunk) {
      const view = m.view;
      thunk = () =>
        view({
          get params() {
            return router!.params();
          },
        });
      thunks.set(view, thunk);
    }
    return thunk;
  });

  return host;
};

/**
 * Client-side anchor: navigates instead of reloading (plain clicks only — lets
 * ctrl/cmd/middle-click open a new tab as usual).
 *
 * Usage in a template: `<Link to="/about">About</Link>`.
 */
export const Link: Component = (props = {}, slots = {}) => {
  const to = String((props as { to?: unknown }).to ?? '/');
  const a = document.createElement('a');
  a.setAttribute('href', to);
  const kids = slots.default?.();
  if (kids) a.appendChild(kids);
  a.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
    e.preventDefault();
    navigate(to);
  });
  return a;
};
