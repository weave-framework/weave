/**
 * @weave-framework/router — the official client router. Built in, not a third-party bolt-on.
 * Zero third-party dependencies (only `@weave-framework/runtime`).
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
 * Async data loading belongs in the component via `@weave-framework/data`.
 */

import { signal, computed, effect, batch, getOwner, createContext, provide, inject } from '@weave-framework/runtime';
import type { Signal, Computed, Context } from '@weave-framework/runtime';
import { ifBlock, transition, type Component, type TransitionFn } from '@weave-framework/runtime/dom';

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

/* ──────────── base path (for hosting under a sub-path, e.g. GitHub Pages) ──────────── */

// All public paths (route patterns, navigate(), Link `to`, currentPath()) are
// "internal" — written as if the app were at the origin root. `basename` is the
// prefix the app is actually served under (default '' = root). It's stripped when
// reading location and re-added when writing history, so nothing else changes.
let basename: string = '';

/** Normalize a base: strip a trailing slash; treat '' / '/' as "no base". */
function normalizeBase(b: string): string {
  const t: string = b.replace(/\/+$/, '');
  return t === '' || t === '/' ? '' : t;
}

/** location.pathname → internal path (drop the basename prefix). */
function stripBase(pathname: string): string {
  if (basename && (pathname === basename || pathname.startsWith(basename + '/'))) {
    const rest: string = pathname.slice(basename.length);
    return rest === '' ? '/' : rest;
  }
  return pathname || '/';
}

/** Internal path → external URL path (prepend the basename). */
function withBase(p: string): string {
  if (!basename) return p;
  return basename + (p.startsWith('/') ? p : '/' + p);
}

/**
 * Set the base path the app is served under (e.g. `/weave` for a project page at
 * `user.github.io/weave/`). Call once before the first render. Default is root.
 */
export function setBasename(base: string): void {
  basename = normalizeBase(base);
  if (typeof location !== 'undefined') path.set(stripBase(location.pathname));
}

const path: Signal<string> = signal(typeof location !== 'undefined' ? stripBase(location.pathname) : '/');
const search: Signal<string> = signal(typeof location !== 'undefined' ? location.search : '');

/* ──────────── navigation hooks + scroll ──────────── */

/** What a navigation was: a `navigate()` push, a back/forward `pop`, or a `replace`. */
export type NavType = 'push' | 'pop' | 'replace';

/** Payload handed to every {@link afterEach} hook after a navigation settles. */
export interface NavInfo {
  path: string;
  search: string;
  hash: string;
  type: NavType;
}

type AfterHook = (nav: NavInfo) => void;
const afterHooks: Set<AfterHook> = new Set<AfterHook>();

/**
 * Register a callback that runs after every navigation (push / pop / replace) —
 * the place for document-title updates, analytics, focus management, etc. Returns
 * an unsubscribe function.
 */
export function afterEach(fn: AfterHook): () => void {
  afterHooks.add(fn);
  return () => void afterHooks.delete(fn);
}

// Built-in scroll handling (on by default in the browser): scroll to top on a new
// navigation, to a `#fragment` element if the URL has one, and restore the saved
// position on back/forward. Apps that manage scroll themselves opt out.
let scrollManaged: boolean = typeof window !== 'undefined';
/** Toggle Weave's built-in scroll handling (top-on-push, `#fragment`, restore-on-pop). */
export function setScrollHandling(on: boolean): void {
  scrollManaged = on;
}

const scrollPositions: Map<number, number> = new Map<number, number>();
let posSeq: number = 0;
let curPos: number = 0;

// Own scroll restoration so the browser's native one doesn't fight ours.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  try {
    history.scrollRestoration = 'manual';
  } catch {
    /* some embedded contexts disallow it */
  }
}

/** Fire the after-hooks, then apply built-in scroll (in a microtask, after the swap). */
function runAfter(nav: NavInfo): void {
  for (const fn of afterHooks) fn(nav);
  if (!scrollManaged || typeof window === 'undefined') return;
  const { type, hash } = nav;
  queueMicrotask(() => {
    if (type === 'pop') {
      window.scrollTo(0, scrollPositions.get(curPos) ?? 0);
      return;
    }
    if (hash) {
      const el: HTMLElement | null = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e: PopStateEvent) => {
    const st: { __wpos?: number } | null = e.state as { __wpos?: number } | null;
    curPos = st && typeof st.__wpos === 'number' ? st.__wpos : 0;
    const internal: string = stripBase(location.pathname);
    batch(() => {
      path.set(internal);
      search.set(location.search);
    });
    runAfter({ path: internal, search: location.search, hash: location.hash, type: 'pop' });
  });
}

/** The reactive current pathname (read-only). */
export const currentPath = (): string => path();

/** Parsed query string as a reactive `{ key: value }` map (last value wins on repeats). */
const queryMap: Computed<RouteParams> = computed<RouteParams>(() => {
  const out: RouteParams = {};
  const s: string = search();
  if (s) new URLSearchParams(s).forEach((v, k) => (out[k] = v));
  return out;
});

/** The reactive current query params (read-only). */
export const currentQuery = (): RouteParams => queryMap();

/** Programmatic navigation (pushes history). Resilient if the env blocks pushState. */
export function navigate(to: string): void {
  const hash: string = to.includes('#') ? to.slice(to.indexOf('#')) : '';
  const noHash: string = to.split('#')[0];
  const qI: number = noHash.indexOf('?');
  const nextPath: string = qI === -1 ? noHash : noHash.slice(0, qI);
  const nextSearch: string = qI === -1 ? '' : noHash.slice(qI);
  // A bare same-URL navigation is a no-op — unless there's a `#fragment` to scroll to.
  if (nextPath === path.peek() && nextSearch === search.peek() && !hash) return;
  // Remember where we are before leaving, so back/forward can restore it.
  if (typeof window !== 'undefined') scrollPositions.set(curPos, window.scrollY);
  const nextPos: number = ++posSeq;
  try {
    // Write the externally-visible URL (basename-prefixed); signals stay internal.
    history.pushState({ __wpos: nextPos }, '', withBase(nextPath) + nextSearch + hash);
    curPos = nextPos;
  } catch {
    /* non-navigable environment (tests, sandboxes) — the signals stay authoritative */
  }
  batch(() => {
    path.set(nextPath);
    search.set(nextSearch);
  });
  runAfter({ path: nextPath, search: nextSearch, hash, type: 'push' });
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
  for (let i: number = 0; i < segs.length; i++) {
    const s: PatternSeg = segs[i];
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
    const m: { params: RouteParams; rest: string[] } | null = matchPrefix(c.segs, pathSegs);
    if (!m) continue;
    const params: RouteParams = { ...inherited, ...m.params };
    if (c.route.redirect) return { redirect: c.route.redirect };
    const verdict: boolean | string = c.route.guard ? c.route.guard({ path: fullPath, params, query }) : true;
    if (verdict === false) return null; // blocked → caller falls back
    if (typeof verdict === 'string') return { redirect: verdict };
    const here: Match = { view: c.route.component!, params };
    if (m.rest.length === 0) {
      // Path fully consumed: include an index child (`path: ''`) if one matches.
      if (c.children.length) {
        const idx: LevelResult = resolveLevel(c.children, [], query, fullPath, params);
        if (idx && 'redirect' in idx) return idx;
        if (idx && 'chain' in idx) return { chain: [here, ...idx.chain] };
      }
      return { chain: [here] };
    }
    // Segments remain: this route only matches if a child consumes the rest.
    if (c.children.length) {
      const sub: LevelResult = resolveLevel(c.children, m.rest, query, fullPath, params);
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
export function createRouter(routes: Route[], options?: { basename?: string }): Router {
  if (options?.basename !== undefined) setBasename(options.basename);
  const compiled: Compiled[] = compileRoutes(routes);
  const fallback: Route | undefined = routes.find((r) => r.path === '*');
  const fallbackChain = (): Match[] =>
    fallback?.component ? [{ view: fallback.component, params: {} }] : [];

  const resolution: Computed<{ chain: Match[]; redirectTo: string | null }> = computed<{
    chain: Match[];
    redirectTo: string | null;
  }>(() => {
    const q: RouteParams = queryMap();
    const start: string = path();
    let p: string = start;
    for (let hops: number = 0; hops < 16; hops++) {
      const res: LevelResult = resolveLevel(compiled, splitSegs(p), q, p, {});
      const synced: string | null = p !== start ? p : null;
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
    let p: string = to.split('#')[0].split('?')[0];
    for (let hops: number = 0; hops < 16; hops++) {
      const res: LevelResult = resolveLevel(compiled, splitSegs(p), {}, p, {});
      if (res && 'redirect' in res) {
        p = res.redirect.split('#')[0].split('?')[0];
        continue;
      }
      const ch: Match[] = res && 'chain' in res ? res.chain : fallbackChain();
      for (const m of ch) (m.view as { preload?: () => void }).preload?.();
      return;
    }
  };

  const router: Router = {
    chain,
    matched: (depth = 0) => chain()[depth] ?? null,
    params: (depth?: number) => {
      const ch: Match[] = chain();
      const i: number = depth ?? ch.length - 1;
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
const OutletContext: Context<OutletCtx | null> = createContext<OutletCtx | null>(null);

/**
 * Router outlet: renders the matched component at its depth in the chain. The top
 * outlet takes `router` as a prop and renders depth 0; a nested `<RouterView/>` written
 * inside a layout discovers the router + its depth via context. A `display:contents`
 * host keeps it layout-neutral. A stable render thunk per component means a param-only
 * change updates `params` in place instead of remounting; switching routes swaps the
 * component. The top outlet also syncs the address bar after a guard/redirect.
 *
 * Pass `transition` (a `TransitionFn`, e.g. `fade`) to animate route changes: the
 * entering view is wrapped in a real host element that plays the intro on swap — so
 * it works even for `lazy()` routes (whose own host is `display:contents`). Author a
 * page-root `out:` if you also want a leave animation.
 *
 * Usage: `<RouterView router={r}/>` at the top, `<RouterView/>` inside each layout.
 */
export const RouterView: Component = (props = {}) => {
  const parentCtx: OutletCtx | null = inject(OutletContext);
  const router: Router | undefined = (props as { router?: Router }).router ?? parentCtx?.router;
  const depth: number = parentCtx ? parentCtx.depth : 0;
  const txFn: TransitionFn<unknown> | undefined = (props as { transition?: TransitionFn<unknown> }).transition;
  const txParams: unknown = (props as { transitionParams?: unknown }).transitionParams;

  // Hand the router + the next depth to any nested outlet below us. Only when an owner
  // scope exists (a directly-invoked RouterView in a test has none — and won't nest).
  if (router && getOwner()) provide(OutletContext, { router, depth: depth + 1 });

  const host: HTMLDivElement = document.createElement('div');
  host.style.display = 'contents';
  const anchorNode: Comment = document.createComment('router');
  host.appendChild(anchorNode);

  // Only the top outlet syncs the URL on a guard/redirect (redirects bubble to the
  // chain root regardless of depth). Owned by this outlet's scope; converges after
  // navigating (resolution then lands on the target → redirectTo() is null).
  if (router && depth === 0) {
    effect(() => {
      const to: string | null = router.redirectTo();
      if (to !== null && to !== path.peek()) navigate(to);
    });
  }

  const thunks: Map<Component, () => Node> = new Map<Component, () => Node>();
  ifBlock(anchorNode, () => {
    const m: Match | null = router?.matched(depth) ?? null;
    if (!m) return null;
    let thunk: (() => Node) | undefined = thunks.get(m.view);
    if (!thunk) {
      const view: Component = m.view;
      thunk = () => {
        const node: Node = view({
          get params() {
            return router!.params(depth);
          },
        });
        if (!txFn) return node;
        // Wrap in a real element so the intro plays even when the view's own root is
        // `display:contents` (lazy host) or a fragment (multi-root template).
        const wrap: HTMLDivElement = document.createElement('div');
        wrap.appendChild(node);
        transition(wrap, txFn, txParams, 'in');
        return wrap;
      };
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
 * Active state (reactive on the current path): when the link's target matches the
 * URL it gets `aria-current="page"` automatically, and — if you name one via
 * `activeClass` — an active CSS class. Matching is prefix-by-segment so a parent
 * link (`/users`) stays active on a child (`/users/42`); pass `exact` to require an
 * exact match. A link to `/` is only ever active at exactly `/`.
 *
 * Usage in a template: `<Link to="/about" activeClass="active">About</Link>`.
 */
export const Link: Component = (props = {}, slots = {}) => {
  const to: string = String((props as { to?: unknown }).to ?? '/');
  // prefetch defaults on: warm the target's lazy chunk on first hover/focus.
  const wantsPrefetch: boolean = (props as { prefetch?: unknown }).prefetch !== false;
  const exact: boolean = (props as { exact?: unknown }).exact === true;
  const activeClass: string | null =
    typeof (props as { activeClass?: unknown }).activeClass === 'string'
      ? (props as { activeClass: string }).activeClass
      : null;
  const a: HTMLAnchorElement = document.createElement('a');
  // The visible href is basename-prefixed (so middle/ctrl-click + SSR are correct);
  // navigation + active-matching use the internal `to`.
  a.setAttribute('href', withBase(to));
  // Forward any other props (class, id, aria-*, title, …) to the anchor, so a
  // `<Link class="nav" aria-label="Home">` actually styles/labels its <a>. The
  // router-owned props and any function/event props are skipped; read once.
  for (const key in props) {
    if (key === 'to' || key === 'prefetch' || key === 'exact' || key === 'activeClass') continue;
    const val: unknown = (props as Record<string, unknown>)[key];
    if (val == null || val === false || typeof val === 'function') continue;
    a.setAttribute(key, val === true ? '' : String(val));
  }
  const kids: Node | undefined = slots.default?.();
  if (kids) a.appendChild(kids);

  // Reactive active state. The target is compared without query/hash; `/` is
  // exact-only (else its prefix would match every path).
  const target: string = to.split('#')[0].split('?')[0];
  const isActive = (cur: string): boolean => {
    if (exact || target === '/') return cur === target;
    if (cur === target) return true;
    return cur.startsWith(target.endsWith('/') ? target : target + '/');
  };
  effect(() => {
    const on: boolean = isActive(currentPath());
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    if (activeClass) a.classList.toggle(activeClass, on);
  });

  a.addEventListener('click', (e) => {
    const me: MouseEvent = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
    e.preventDefault();
    navigate(to);
  });
  if (wantsPrefetch) {
    let warmed: boolean = false;
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
