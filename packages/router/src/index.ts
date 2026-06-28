/**
 * @weave/router — the official client router. Built in, not a third-party bolt-on.
 * Zero third-party dependencies (only `@weave/runtime`).
 *
 * History-based and signal-driven: the current path and query are signals, so any
 * view that reads them updates surgically on navigation. Routes are an ordered tree
 * of `{ path, component?, guard?, redirect?, children? }` objects (`'*'` = catch-all
 * fallback), supporting path params (`/user/:id`), query parsing (`?tab=x`), **sync
 * guards** (read auth signals; return `true`/`false`/a redirect path), static
 * `redirect`s, and **nested routes** (a parent layout renders a nested `<RouterView>`).
 *
 * Matching produces a *chain* of matches (layout → … → leaf). The top `<RouterView>`
 * renders the chain's first component; each nested `<RouterView>` renders the next,
 * discovering its depth + the router through **provide/inject** (no prop drilling).
 *
 * Guards are synchronous by design: they run inside the reactive resolution and read
 * signals (e.g. `isAuthed()`), so a route re-resolves automatically when auth changes.
 * Async data loading belongs in the component via `@weave/data`.
 */

import { signal, computed, effect, batch, getOwner, createContext, provide, inject } from '@weave/runtime';
import { ifBlock, type Component } from '@weave/runtime/dom';

export type RouteParams = Record<string, string>;

/** Context handed to a guard: the resolved path, accumulated path params, and query. */
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
  /** Path pattern: `/`, `/users`, `/user/:id`, `''` (index child), or `'*'` (fallback). */
  path: string;
  /** Component to render when matched (a layout, if it has `children`). */
  component?: Component;
  /** Sync guard: `true` allows, `false` blocks (→ fallback), a string redirects. */
  guard?: Guard;
  /** Static redirect target (pathname). When matched, resolve to this path instead. */
  redirect?: string;
  /** Nested routes, matched against the path remainder under this route. */
  children?: Route[];
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

/* ──────────────────────────── matching ──────────────────────────── */

type PatternSeg = { param: string } | { literal: string };

interface Compiled {
  route: Route;
  segs: PatternSeg[];
  children: Compiled[];
}

const splitSegs = (s: string): string[] => s.split('/').filter(Boolean);

function parsePattern(pattern: string): PatternSeg[] {
  return splitSegs(pattern).map((s) =>
    s.startsWith(':') ? { param: s.slice(1) } : { literal: s }
  );
}

function compileRoutes(routes: Route[]): Compiled[] {
  return routes
    .filter((r) => r.path !== '*')
    .map((r) => ({
      route: r,
      segs: parsePattern(r.path),
      children: r.children ? compileRoutes(r.children) : [],
    }));
}

/** Match a pattern's segments against a leading run of the path; return params + remainder. */
function matchPrefix(
  segs: PatternSeg[],
  pathSegs: string[]
): { params: RouteParams; rest: string[] } | null {
  if (segs.length > pathSegs.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if ('param' in s) params[s.param] = decodeURIComponent(pathSegs[i]);
    else if (s.literal !== pathSegs[i]) return null;
  }
  return { params, rest: pathSegs.slice(segs.length) };
}

/** A reactive match: a component + the path params accumulated down to its depth. */
export interface Match {
  view: Component;
  params: RouteParams;
}

type LevelResult = { chain: Match[] } | { redirect: string } | null;

/** Resolve one sibling level: first matching route → redirect / guard / descend / leaf. */
function resolveLevel(
  routes: Compiled[],
  pathSegs: string[],
  query: RouteParams,
  fullPath: string,
  inherited: RouteParams
): LevelResult {
  for (const c of routes) {
    const m = matchPrefix(c.segs, pathSegs);
    if (!m) continue;
    const params = { ...inherited, ...m.params };
    if (c.route.redirect) return { redirect: c.route.redirect };
    const verdict = c.route.guard ? c.route.guard({ path: fullPath, params, query }) : true;
    if (verdict === false) return null; // blocked → caller falls back
    if (typeof verdict === 'string') return { redirect: verdict };
    const here: Match = { view: c.route.component!, params };
    if (m.rest.length === 0) {
      // Path fully consumed: include an index child (`path: ''`) if one matches.
      if (c.children.length) {
        const idx = resolveLevel(c.children, [], query, fullPath, params);
        if (idx && 'redirect' in idx) return idx;
        if (idx && 'chain' in idx) return { chain: [here, ...idx.chain] };
      }
      return { chain: [here] };
    }
    // Segments remain: this route only matches if a child consumes the rest.
    if (c.children.length) {
      const sub = resolveLevel(c.children, m.rest, query, fullPath, params);
      if (sub && 'redirect' in sub) return sub;
      if (sub && 'chain' in sub) return { chain: [here, ...sub.chain] };
    }
    // No child matched the remainder → not a full match; try the next sibling.
  }
  return null;
}

export interface Router {
  /** The match at `depth` in the resolved chain (default 0 — the top component), or null. */
  matched: (depth?: number) => Match | null;
  /** The full resolved chain (layout → … → leaf). */
  chain: () => Match[];
  /** Accumulated path params at `depth` (default: the leaf — i.e. all params). */
  params: (depth?: number) => RouteParams;
  /** The current query params (reactive). */
  query: () => RouteParams;
  /** Canonical pathname the URL should sync to after a guard/redirect, or null. */
  redirectTo: () => string | null;
  /** Warm a path's lazy route chunk(s) ahead of navigation (Link prefetch). */
  preload: (to: string) => void;
}

/** The most recently created router — the target of the module-level {@link prefetch}. */
let activeRouter: Router | null = null;

/**
 * Build a router from an ordered `Route[]` tree (`path: '*'` = catch-all fallback).
 * Resolution is a single reactive computation producing a match *chain*; redirect and
 * guard-redirect hops are followed (capped at 16 to break loops). Place the output with
 * a top `<RouterView router={r}/>` and a nested `<RouterView/>` inside each layout.
 */
export function createRouter(routes: Route[]): Router {
  const compiled = compileRoutes(routes);
  const fallback = routes.find((r) => r.path === '*');
  const fallbackChain = (): Match[] =>
    fallback?.component ? [{ view: fallback.component, params: {} }] : [];

  const resolution = computed<{ chain: Match[]; redirectTo: string | null }>(() => {
    const q = queryMap();
    const start = path();
    let p = start;
    for (let hops = 0; hops < 16; hops++) {
      const res = resolveLevel(compiled, splitSegs(p), q, p, {});
      const synced = p !== start ? p : null;
      if (res && 'redirect' in res) {
        p = res.redirect.split('#')[0].split('?')[0];
        continue;
      }
      if (res && 'chain' in res) return { chain: res.chain, redirectTo: synced };
      return { chain: fallbackChain(), redirectTo: synced };
    }
    return { chain: [], redirectTo: null }; // redirect loop — give up rather than spin
  });

  const chain = (): Match[] => resolution().chain;

  /** Non-reactive resolve of an arbitrary path → preload each chunk in its chain. */
  const preload = (to: string): void => {
    let p = to.split('#')[0].split('?')[0];
    for (let hops = 0; hops < 16; hops++) {
      const res = resolveLevel(compiled, splitSegs(p), {}, p, {});
      if (res && 'redirect' in res) {
        p = res.redirect.split('#')[0].split('?')[0];
        continue;
      }
      const ch = res && 'chain' in res ? res.chain : fallbackChain();
      for (const m of ch) (m.view as { preload?: () => void }).preload?.();
      return;
    }
  };

  const router: Router = {
    chain,
    matched: (depth = 0) => chain()[depth] ?? null,
    params: (depth?: number) => {
      const ch = chain();
      const i = depth ?? ch.length - 1;
      return ch[i]?.params ?? {};
    },
    query: () => queryMap(),
    redirectTo: () => resolution().redirectTo,
    preload,
  };
  activeRouter = router; // most-recent router answers the module-level prefetch()
  return router;
}

/** Warm a path's lazy route chunk(s) via the active router (no-op if none / not lazy). */
export function prefetch(to: string): void {
  activeRouter?.preload(to);
}

/* ──────────────────────────── outlets ──────────────────────────── */

interface OutletCtx {
  router: Router;
  depth: number;
}

/** Carries the router + the next outlet's depth down the tree (set by each RouterView). */
const OutletContext = createContext<OutletCtx | null>(null);

/**
 * Router outlet: renders the matched component at its depth in the chain. The top
 * outlet takes `router` as a prop and renders depth 0; a nested `<RouterView/>` written
 * inside a layout discovers the router + its depth via context. A `display:contents`
 * host keeps it layout-neutral. A stable render thunk per component means a param-only
 * change updates `params` in place instead of remounting; switching routes swaps the
 * component. The top outlet also syncs the address bar after a guard/redirect.
 *
 * Usage: `<RouterView router={r}/>` at the top, `<RouterView/>` inside each layout.
 */
export const RouterView: Component = (props = {}) => {
  const parentCtx = inject(OutletContext);
  const router = (props as { router?: Router }).router ?? parentCtx?.router;
  const depth = parentCtx ? parentCtx.depth : 0;

  // Hand the router + the next depth to any nested outlet below us. Only when an owner
  // scope exists (a directly-invoked RouterView in a test has none — and won't nest).
  if (router && getOwner()) provide(OutletContext, { router, depth: depth + 1 });

  const host = document.createElement('div');
  host.style.display = 'contents';
  const anchorNode = document.createComment('router');
  host.appendChild(anchorNode);

  // Only the top outlet syncs the URL on a guard/redirect (redirects bubble to the
  // chain root regardless of depth). Owned by this outlet's scope; converges after
  // navigating (resolution then lands on the target → redirectTo() is null).
  if (router && depth === 0) {
    effect(() => {
      const to = router.redirectTo();
      if (to !== null && to !== path.peek()) navigate(to);
    });
  }

  const thunks = new Map<Component, () => Node>();
  ifBlock(anchorNode, () => {
    const m = router?.matched(depth) ?? null;
    if (!m) return null;
    let thunk = thunks.get(m.view);
    if (!thunk) {
      const view = m.view;
      thunk = () =>
        view({
          get params() {
            return router!.params(depth);
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
  // prefetch defaults on: warm the target's lazy chunk on first hover/focus.
  const wantsPrefetch = (props as { prefetch?: unknown }).prefetch !== false;
  const a = document.createElement('a');
  a.setAttribute('href', to);
  // Forward any other props (class, id, aria-*, title, …) to the anchor, so a
  // `<Link class="nav" aria-label="Home">` actually styles/labels its <a>. The
  // router-owned props and any function/event props are skipped; read once.
  for (const key in props) {
    if (key === 'to' || key === 'prefetch') continue;
    const val = (props as Record<string, unknown>)[key];
    if (val == null || val === false || typeof val === 'function') continue;
    a.setAttribute(key, val === true ? '' : String(val));
  }
  const kids = slots.default?.();
  if (kids) a.appendChild(kids);
  a.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
    e.preventDefault();
    navigate(to);
  });
  if (wantsPrefetch) {
    let warmed = false;
    const warm = (): void => {
      if (warmed) return;
      warmed = true;
      prefetch(to);
    };
    a.addEventListener('pointerenter', warm);
    a.addEventListener('focusin', warm);
  }
  return a;
};

export {
  fileToRoutes,
  emitRoutesModule,
  type FileRoute,
  type EmitRoutesOptions,
} from './files.js';
