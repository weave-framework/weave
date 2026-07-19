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

import { signal, computed, effect, batch, onCleanup, getOwner, createContext, provide, inject } from '@weave-framework/runtime';
import type { Signal, Computed, Context } from '@weave-framework/runtime';
import { ifBlock, transition, type Component, type TransitionFn } from '@weave-framework/runtime/dom';

/** Path parameters matched from the URL, as a string map (`/users/:id` → `{ id: '42' }`). */
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
  /**
   * Route-level data loader. Runs when the route is rendered; its result is exposed to
   * the component (and descendants) via {@link useLoaderData}, which returns an
   * `@await`-compatible `{ data, loading, error }` — so `@await (useLoaderData())` just
   * works. Re-runs when this route's params/query change; the previous run is aborted.
   */
  loader?: (ctx: LoaderContext) => unknown;
  /** Nested routes, matched against the path remainder under this route. */
  children?: Route[];
}

/** Context handed to a route {@link Route.loader}: the (typed, via `route()`) params, query, and an abort signal. */
export interface LoaderContext<P = RouteParams> {
  params: P;
  query: RouteParams;
  /** Aborted when the loader re-runs (param/query change) or the route unmounts. */
  signal: AbortSignal;
}

/**
 * Type-level path-param inference: turns a path literal into the params object its
 * matches carry. `'/user/:id'` → `{ id: string }`, `'/user/:id/post/:pid'` →
 * `{ id: string; pid: string }`, a param-less path → `{}`. Used by {@link route} so
 * `guard`/`loader` see typed `params`.
 */
export type RouteParamsOf<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof RouteParamsOf<`/${Rest}`>]: string }
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<never, string>;

/** Config for {@link route} — like {@link Route} minus `path`, with a typed `guard`. */
export interface RouteConfig<Path extends string = string> {
  component?: Component;
  /** Sync guard with params typed from the path literal. */
  guard?: (ctx: { path: string; params: RouteParamsOf<Path>; query: RouteParams }) => boolean | string;
  /** Data loader with params typed from the path literal (`route('/user/:id', …)` → `params.id`). */
  loader?: (ctx: LoaderContext<RouteParamsOf<Path>>) => unknown;
  redirect?: string;
  children?: Route[];
}

/**
 * Typed route builder. Captures the path *literal* in a generic so `guard` (and, in v2,
 * `loader`) receive `params` inferred from the path — `route('/user/:id', …)` gives
 * `params.id: string`. Returns a plain {@link Route}, so it drops into the same
 * `createRouter([...])` array and nests via `children`. Plain-object routes still work
 * (with untyped `params`); `route()` is the opt-in for inference.
 */
export function route<Path extends string>(path: Path, config: RouteConfig<Path> = {}): Route {
  return { path, ...config } as unknown as Route;
}

/* ──────────── base path (for hosting under a sub-path, e.g. GitHub Pages) ──────────── */

// All public paths (route patterns, navigate(), Link `to`, currentPath()) are
// "internal" — written as if the app were at the origin root. `basename` is the
// prefix the app is actually served under (default '' = root). It's stripped when
// reading location and re-added when writing history, so nothing else changes.
let basename: string = '';

/** Normalize a base: strip trailing slashes; treat '' / '/' as "no base". */
function normalizeBase(b: string): string {
  // Non-regex trailing-slash trim (a `/\/+$/` regex is a polynomial-ReDoS shape).
  let end: number = b.length;
  while (end > 0 && b[end - 1] === '/') end--;
  return b.slice(0, end);
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
  if (typeof location !== 'undefined') activeState.path.set(stripBase(location.pathname));
}

/**
 * Per-router reactive state. v2 (C5): a router **owns its signals** (path / search /
 * query) instead of the module holding one global set — so multiple routers, isolated
 * tests, and (later) a per-request SSR render each get their own URL. `activeState` is
 * the browser-active router's state that the module-level sugar (`navigate` /
 * `currentPath` / …) and the `popstate` listener read + write; it's the most-recently
 * created router, or `defaultState` before any `createRouter`.
 */
interface RouterState {
  path: Signal<string>;
  search: Signal<string>;
  query: Computed<RouteParams>;
  /** Wrap this router's navigations in `document.startViewTransition` when supported. */
  vt: boolean;
}
/**
 * Request-scoped location for a headless (SSR/SSG) render. There is no `window.location` on the server, so
 * this is how the build tells the router which route to render. Consulted by {@link createState} for every
 * router created after it is set; {@link setServerLocation} also updates an already-created router.
 */
let serverLocation: { pathname: string; search: string } | null = null;

/** Split a URL into pathname + search, dropping any hash. */
function splitUrl(url: string): { pathname: string; search: string } {
  const noHash: string = url.split('#')[0];
  const q: number = noHash.indexOf('?');
  return q === -1
    ? { pathname: noHash || '/', search: '' }
    : { pathname: noHash.slice(0, q) || '/', search: noHash.slice(q) };
}

/**
 * Seed the router's location for a headless (SSR/SSG) render — the server has no `window.location`, so this
 * is how the build says which route to render. It (a) seeds every router created afterward (a `createRouter`
 * inside the rendered component) and (b) updates the active router if one already exists (a module-level
 * `createRouter`), so its resolution recomputes. No-op semantics in the browser: when a real `location` is
 * present the router reads that instead, so calling this changes nothing there. Pass the internal path
 * (basename is applied exactly as when reading `location`).
 */
export function setServerLocation(url: string): void {
  serverLocation = splitUrl(url);
  if (typeof location === 'undefined') {
    batch(() => {
      activeState.path.set(stripBase(serverLocation!.pathname));
      activeState.search.set(serverLocation!.search);
    });
  }
}

function createState(): RouterState {
  const hasLoc: boolean = typeof location !== 'undefined';
  const initPath: string = hasLoc ? location.pathname : serverLocation?.pathname ?? '/';
  const initSearch: string = hasLoc ? location.search : serverLocation?.search ?? '';
  const path: Signal<string> = signal(stripBase(initPath));
  const search: Signal<string> = signal(initSearch);
  // Parsed query string as a reactive `{ key: value }` map (last value wins on repeats).
  const query: Computed<RouteParams> = computed<RouteParams>(() => {
    const out: RouteParams = {};
    const s: string = search();
    if (s) new URLSearchParams(s).forEach((v, k) => (out[k] = v));
    return out;
  });
  return { path, search, query, vt: false };
}

/** Document with the View Transitions API (typed narrowly so we can feature-detect zero-dep). */
type VTDocument = Document & { startViewTransition?: (cb: () => void | Promise<void>) => unknown };

/**
 * Apply a state mutation, wrapped in a native View Transition when this router opted in
 * (`viewTransitions: true`) and the browser supports it. Weave's updates are synchronous,
 * so the outlet's swap happens *inside* the callback — the browser snapshots before/after
 * and cross-fades. Unsupported browsers (or `vt: false`) just apply directly — a graceful
 * fallback, and any Weave `transition` prop on `<RouterView>` still plays as before.
 */
function applyWithViewTransition(state: RouterState, apply: () => void): void {
  const doc: VTDocument | undefined = typeof document !== 'undefined' ? (document as VTDocument) : undefined;
  if (state.vt && doc && typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(apply);
  } else {
    apply();
  }
}
const defaultState: RouterState = createState();
let activeState: RouterState = defaultState;

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

/* ──────────── before-leave guards (async, cancellable) ──────────── */

/** Where a pending navigation is going, and how it was triggered — handed to every {@link LeaveGuard}. */
export interface LeaveInfo {
  /** The target pathname (query/hash excluded). */
  to: string;
  /** The current pathname being left. */
  from: string;
  /** How the navigation was triggered — same set as {@link NavType}. */
  type: NavType;
}

/**
 * A before-leave guard. Runs BEFORE a navigation commits and may be async: return
 * `true` (or `Promise<true>`) to allow, `false` (or `Promise<false>`) to cancel and
 * stay put. Unlike a route {@link Guard} it can await a user decision (e.g. an
 * "unsaved changes" dialog) before the navigation happens.
 */
export type LeaveGuard = (nav: LeaveInfo) => boolean | Promise<boolean>;

const beforeHooks: Set<LeaveGuard> = new Set<LeaveGuard>();

/**
 * Register a guard run BEFORE every navigation (push / replace / pop). If any guard
 * resolves `false`, the navigation is cancelled: the current path is kept, the address
 * bar stays put, and a back/forward is rolled back so URL and history stay in sync.
 * ALL guards must allow for the navigation to proceed; the first `false` short-circuits
 * (later guards don't run). Returns an unregister function — call it in the component's
 * cleanup so the guard lives only while the page is mounted.
 */
export function beforeEach(fn: LeaveGuard): () => void {
  beforeHooks.add(fn);
  return () => void beforeHooks.delete(fn);
}

/** Run the before-leave guards in registration order; resolves `false` on the first veto. */
async function canLeave(info: LeaveInfo): Promise<boolean> {
  for (const fn of beforeHooks) {
    // `await` transparently handles both a plain boolean and a Promise<boolean>.
    if ((await fn(info)) === false) return false;
  }
  return true;
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

// Seed the position from the entry we actually loaded on. `pushState` state SURVIVES a reload, so after a
// refresh in the middle of a history stack the restored entry still carries its `__wpos` while `curPos`
// would reset to 0 — and every direction test after that is wrong: a Back to position 4 reads as `4 <= 0`
// false, i.e. a Forward, so a vetoed pop rolled further back instead of returning. `posSeq` moves with it
// so a subsequent push cannot mint a position that collides with an entry already in the stack.
if (typeof history !== 'undefined') {
  const boot: { __wpos?: number } | null = history.state as { __wpos?: number } | null;
  if (boot && typeof boot.__wpos === 'number') {
    curPos = boot.__wpos;
    posSeq = boot.__wpos;
  }
}

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
  // True while we roll back a guard-cancelled pop — the resulting popstate is ours, not the user's.
  let reverting: boolean = false;
  window.addEventListener('popstate', (e: PopStateEvent) => {
    if (reverting) {
      reverting = false; // swallow the reversal's own popstate; state is already consistent
      return;
    }
    const st: { __wpos?: number } | null = e.state as { __wpos?: number } | null;
    const targetPos: number = st && typeof st.__wpos === 'number' ? st.__wpos : 0;
    const to: string = stripBase(location.pathname);
    const from: string = activeState.path.peek();

    const commit = (): void => {
      curPos = targetPos;
      applyWithViewTransition(activeState, () => {
        batch(() => {
          activeState.path.set(to);
          activeState.search.set(location.search);
        });
      });
      runAfter({ path: to, search: location.search, hash: location.hash, type: 'pop' });
    };

    // No before-leave guards, or not actually changing page → commit immediately (unchanged behavior).
    if (beforeHooks.size === 0 || to === from) {
      commit();
      return;
    }
    // The browser has already moved the URL; remember HOW FAR so a veto can undo exactly that much. The
    // rollback used to be a hardcoded ±1 while the jump can be any size (a history dropdown, a long-press
    // back), so vetoing a three-entry jump landed on an intermediate entry with the old page still
    // rendered — URL and view desynced, and the resulting popstate was swallowed as one of ours.
    const delta: number = curPos - targetPos;
    void canLeave({ to, from, type: 'pop' }).then((ok) => {
      if (ok) {
        commit();
        return;
      }
      // Cancelled: roll history back the way we came so the URL + entry match staying put. A zero delta
      // (an entry with no recorded position) would be a no-op that leaves `reverting` armed to swallow
      // someone else's pop, so fall back to a single step in the direction we appear to have travelled.
      reverting = true;
      try {
        history.go(delta !== 0 ? delta : 1);
      } catch {
        reverting = false;
      }
    });
  });
}

/** The reactive current pathname of the active router (read-only). */
export const currentPath = (): string => activeState.path();

/** The reactive current query params of the active router (read-only). */
export const currentQuery = (): RouteParams => activeState.query();

/**
 * Commit a push/replace navigation on `state`: write history, update the signals (inside a
 * View Transition when enabled), and fire the after-hooks. Split out of {@link navigateState}
 * so an async before-leave guard can gate it.
 */
function commitNavigate(
  state: RouterState,
  nextPath: string,
  nextSearch: string,
  hash: string,
  replace: boolean
): void {
  // Write the externally-visible URL (basename-prefixed); signals stay internal.
  const url: string = withBase(nextPath) + nextSearch + hash;
  try {
    if (replace) {
      // Replace swaps the current entry (and keeps its history position + saved scroll).
      history.replaceState({ __wpos: curPos }, '', url);
    } else {
      // Remember where we are before leaving, so back/forward can restore the scroll.
      if (typeof window !== 'undefined') scrollPositions.set(curPos, window.scrollY);
      const nextPos: number = ++posSeq;
      history.pushState({ __wpos: nextPos }, '', url);
      curPos = nextPos;
    }
  } catch {
    /* non-navigable environment (tests, sandboxes) — the signals stay authoritative */
  }
  applyWithViewTransition(state, () => {
    batch(() => {
      state.path.set(nextPath);
      state.search.set(nextSearch);
    });
  });
  runAfter({ path: nextPath, search: nextSearch, hash, type: replace ? 'replace' : 'push' });
}

/** Options for {@link navigate}: `replace` swaps the current history entry instead of pushing a new one. */
export interface NavigateOptions {
  replace?: boolean;
}

/** Programmatic navigation against a specific router state (push, or replace). Gated by before-leave guards. */
function navigateState(state: RouterState, to: string, opts?: NavigateOptions): void {
  const replace: boolean = opts?.replace === true;
  const hash: string = to.includes('#') ? to.slice(to.indexOf('#')) : '';
  const noHash: string = to.split('#')[0];
  const qI: number = noHash.indexOf('?');
  // A bare `#fragment` carries no path part, so `noHash` is empty. Read as a path that resolved
  // to `/`, which meant an in-page anchor link silently navigated the app to the root route. It
  // means "this page, scroll there" — keep the current path and query.
  const bareHash: boolean = hash !== '' && noHash === '';
  const nextPath: string = bareHash ? state.path.peek() : qI === -1 ? noHash : noHash.slice(0, qI);
  const nextSearch: string = bareHash ? state.search.peek() : qI === -1 ? '' : noHash.slice(qI);
  // A bare same-URL navigation is a no-op — unless there's a `#fragment` to scroll to.
  if (nextPath === state.path.peek() && nextSearch === state.search.peek() && !hash) return;
  // Fast path: no before-leave guards → commit synchronously (unchanged behavior + timing).
  if (beforeHooks.size === 0) {
    commitNavigate(state, nextPath, nextSearch, hash, replace);
    return;
  }
  // Guards present → await their verdict before committing; any `false` cancels (stay put).
  const info: LeaveInfo = { to: nextPath, from: state.path.peek(), type: replace ? 'replace' : 'push' };
  void canLeave(info).then((ok) => {
    if (ok) commitNavigate(state, nextPath, nextSearch, hash, replace);
  });
}

/** Programmatic navigation on the active router (push, or `{ replace: true }`). Resilient if the env blocks history. */
export function navigate(to: string, opts?: NavigateOptions): void {
  navigateState(activeState, to, opts);
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

/** Decode one path segment, passing it through unchanged when it is not valid percent-encoding. */
function decodeParam(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
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
    // A lone or malformed `%` makes `decodeURIComponent` throw `URIError`, and this runs inside the
    // resolution COMPUTED — so the throw escaped through `matched()`/`params()`, killed the RouterView
    // effect and blanked the page instead of falling back to `*`. Any user-controlled URL reaches here,
    // including one a mis-built link produced. An undecodable segment is passed through raw: the route
    // still matches and the app still renders, which beats losing the whole page over one character.
    if ('param' in s) params[s.param] = decodeParam(pathSegs[i]);
    else if (s.literal !== pathSegs[i]) return null;
  }
  return { params, rest: pathSegs.slice(segs.length) };
}

/** A reactive match: a component + the path params accumulated down to its depth. */
export interface Match {
  view: Component;
  params: RouteParams;
  /** This route's data loader, if any (run by the outlet; read via {@link useLoaderData}). */
  loader?: (ctx: LoaderContext) => unknown;
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
    const here: Match = { view: c.route.component!, params, loader: c.route.loader };
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

/** A router instance — owns its reactive URL state and resolves the matched route chain. Created by {@link createRouter}; reach the ambient one with {@link useRouter}. */
export interface Router {
  /** The match at `depth` in the resolved chain (default 0 — the top component), or null. */
  matched: (depth?: number) => Match | null;
  /** The full resolved chain (layout → … → leaf). */
  chain: () => Match[];
  /** Accumulated path params at `depth` (default: the leaf — i.e. all params). */
  params: (depth?: number) => RouteParams;
  /** This router's reactive current pathname (read-only). */
  path: () => string;
  /** The current query params (reactive). */
  query: () => RouteParams;
  /** Navigate this router (push, or `{ replace: true }`). Gated by before-leave guards. */
  navigate: (to: string, opts?: NavigateOptions) => void;
  /** Go back one history entry. */
  back: () => void;
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
export function createRouter(routes: Route[], options?: { basename?: string; viewTransitions?: boolean }): Router {
  // This router owns its reactive state and becomes the browser-active one (the target
  // of the module-level sugar + the popstate listener). Set active BEFORE applying the
  // basename so `setBasename` corrects THIS router's path.
  const state: RouterState = createState();
  state.vt = !!options?.viewTransitions;
  activeState = state;
  if (options?.basename !== undefined) setBasename(options.basename);
  const compiled: Compiled[] = compileRoutes(routes);
  const fallback: Route | undefined = routes.find((r) => r.path === '*');
  const fallbackChain = (): Match[] =>
    fallback?.component ? [{ view: fallback.component, params: {} }] : [];

  const resolution: Computed<{ chain: Match[]; redirectTo: string | null }> = computed<{
    chain: Match[];
    redirectTo: string | null;
  }>(() => {
    const q: RouteParams = state.query();
    const start: string = state.path();
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
    path: () => state.path(),
    query: () => state.query(),
    navigate: (to: string, opts?: NavigateOptions) => navigateState(state, to, opts),
    back: () => back(),
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
 * What `adoptComponent` hands a self-adopting component as its `$adopt` prop (Phase E, E1.12).
 *
 * Declared here rather than imported from `@weave-framework/runtime/adopt` ON PURPOSE: a type-only import would
 * be erased, but keeping this package free of any runtime/adopt reference makes it structurally impossible to
 * pull the resume entry into a plain SPA bundle (invariant I3 — 0 bytes for apps that don't resume). The shape
 * is tiny and pinned by the SSG smoke.
 */
interface AdoptTarget {
  /** The outlet's server-rendered host — reuse it instead of building a fresh one. */
  root: Node;
  /** The resume state map — where a routed view's captured ctx lives, keyed `$route:<depth>`. */
  states: Record<string, unknown>;
  /** Register the view we resume ourselves, so ITS `on:` handlers resolve against ITS ctx (E1.8 dispatch). */
  register: (
    root: Element,
    handlers: (ctx: Record<string, unknown>) => Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => void;
}

/**
 * Inject the router from context — the canonical way a routed component reaches its
 * router (`const r = useRouter(); r.navigate('/x'); r.params()`). Must be called within
 * a `<RouterView>` subtree; the module-level `navigate()`/`currentPath()` sugar covers
 * code outside the routed tree.
 */
export function useRouter(): Router {
  const ctx: OutletCtx | null = inject(OutletContext);
  if (!ctx?.router) {
    throw new Error('useRouter() must be called within a <RouterView> subtree');
  }
  return ctx.router;
}

/**
 * Reactive view of a route loader's result — the same `{ data, loading, error }` shape a
 * `@weave-framework/data` resource exposes, so it drives `@await` directly.
 */
export interface LoaderData<T = unknown> {
  /** Latest resolved value, or `undefined` while pending. Reactive. */
  data: () => T | undefined;
  /** True while the loader is in flight (initial run + each re-run). Reactive. */
  loading: () => boolean;
  /** The last rejection, or `undefined`. Cleared at the start of each run. Reactive. */
  error: () => unknown;
}

/** Carries the current route's loader result down to the component + descendants. */
const LoaderDataContext: Context<LoaderData | null> = createContext<LoaderData | null>(null);

/**
 * Read the current route's {@link Route.loader} result inside a routed component. Returns
 * an `@await`-compatible `{ data, loading, error }`, so `@await (useLoaderData())` renders
 * pending / value / error branches. Throws if the route has no loader.
 */
export function useLoaderData<T = unknown>(): LoaderData<T> {
  const data: LoaderData | null = inject(LoaderDataContext);
  if (!data) {
    throw new Error('useLoaderData() requires the current route to define a loader');
  }
  return data as LoaderData<T>;
}

/**
 * Run a match's loader as a reactive resource: (re)runs whenever this depth's params or
 * query change (keyed, so unrelated navigations don't refetch), aborting the previous run
 * and ignoring its late settle. Runtime-only (no `@weave-framework/data` dependency) —
 * loaders need just load/value/error + abort, which the `@await` contract is built on.
 *
 * SSR seam (Phase D, RFC 0001 §4): a future `renderToString` will `await` these before
 * serializing and seed the resolved value into the page so the client hydrates without a
 * re-fetch — this resource is the single place that wiring will hook in.
 */
function createLoaderResource(match: Match, router: Router, depth: number): LoaderData {
  const dataSig: Signal<unknown> = signal<unknown>(undefined);
  const loadingSig: Signal<boolean> = signal<boolean>(true);
  const errorSig: Signal<unknown> = signal<unknown>(undefined);
  let token: number = 0;
  let lastKey: string | null = null;
  let ac: AbortController | null = null;

  effect(() => {
    const params: RouteParams = router.params(depth);
    const query: RouteParams = router.query();
    const key: string = JSON.stringify(params) + ' ' + JSON.stringify(query);
    if (key === lastKey) return; // same inputs → don't re-run on an unrelated navigation
    lastKey = key;

    const my: number = ++token;
    ac?.abort();
    ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal: AbortSignal = ac ? ac.signal : ({ aborted: false } as AbortSignal);
    batch(() => {
      loadingSig.set(true);
      errorSig.set(undefined);
    });
    Promise.resolve()
      .then(() => match.loader!({ params, query, signal }))
      .then(
        (value: unknown) => {
          // `set(() => value)`, not `set(value)`: `Signal.set` reads ANY function argument as an updater
          // `(prev) => next`, so a loader resolving to a FUNCTION — a component, a factory, a formatter —
          // was CALLED with the previous data and whatever it returned was stored instead of the value.
          if (my === token) batch(() => { dataSig.set(() => value); loadingSig.set(false); });
        },
        (err: unknown) => {
          if (my === token) batch(() => { errorSig.set(err); loadingSig.set(false); });
        }
      );
  });
  onCleanup(() => ac?.abort());

  return { data: () => dataSig(), loading: () => loadingSig(), error: () => errorSig() };
}

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

  // Phase E (E1.12) — resume. `$adopt` is handed in by `adoptComponent` when this outlet is being resumed from
  // a server render: reuse the server's host + anchor instead of building them, and let the first branch
  // ADOPT the already-rendered view (below) rather than re-render it. A transition would have to play an
  // intro over DOM that is already painted, so an outlet with one declines and re-renders instead. Arriving as
  // a PROP is what keeps this package free of the resume entries (invariant I3 — 0 bytes for a plain SPA).
  const adoptTarget: AdoptTarget | undefined = (props as { $adopt?: AdoptTarget }).$adopt;
  const adopting: boolean = !!adoptTarget && !txFn;

  let host: HTMLDivElement;
  let anchorNode: Comment;
  if (adopting) {
    host = adoptTarget!.root as HTMLDivElement;
    anchorNode = host.lastChild as Comment; // the server serialized our `<!--router-->` last
  } else {
    host = document.createElement('div');
    host.style.display = 'contents';
    anchorNode = document.createComment('router');
    host.appendChild(anchorNode);
  }

  // Only the top outlet syncs the URL on a guard/redirect (redirects bubble to the
  // chain root regardless of depth). Owned by this outlet's scope; converges after
  // navigating (resolution then lands on the target → redirectTo() is null).
  if (router && depth === 0) {
    effect(() => {
      const to: string | null = router.redirectTo();
      // REPLACE, not push. Pushing left [/admin, /login] in history: Back returned to /admin, the guard
      // re-fired and pushed /login again, so the user could never get back out. A redirect means "you were
      // never here", which is what replacing the entry expresses.
      if (to !== null && to !== router.path()) router.navigate(to, { replace: true });
    });
  }

  /**
   * ADOPT the view the server already rendered into `host` (E1.12), or null if we can't.
   *
   * The nodes between `host.firstChild` and our anchor ARE the server's view. Re-bind them against the view's
   * resumed ctx (registered under `$route:<depth>` by the `$wid` the create path passes below), then hand them
   * back in a fragment: `ifBlock` re-inserts them exactly where they already are, and now TRACKS them, so a
   * later navigation disposes + removes them like any branch it rendered itself.
   */
  const adoptView = (view: Component): Node | null => {
    const nodes: ChildNode[] = [];
    for (let n: ChildNode | null = host.firstChild; n && n !== anchorNode; n = n.nextSibling) nodes.push(n);
    const viewRoot: ChildNode | undefined = nodes.find((n) => n.nodeType === 1);
    const vctx: unknown = adoptTarget!.states[routeStateId(depth)];
    const v: Component & {
      adopt?: (r: Node, c: Record<string, unknown>, s: Record<string, unknown>, st: Record<string, unknown>) => unknown;
      derive?: (c: Record<string, unknown>) => unknown;
      handlers?: (c: Record<string, unknown>) => Record<string, unknown>;
    } = view;
    if (!v.adopt || vctx === undefined || !viewRoot) {
      // Not resumable (or nothing captured) → drop the server DOM and let the caller render fresh.
      for (const n of nodes) n.remove();
      return null;
    }
    if (v.derive) v.derive(vctx as Record<string, unknown>);
    v.adopt(viewRoot, vctx as Record<string, unknown>, {}, adoptTarget!.states);
    // We resumed this view ourselves, so adoptComponent never saw it — register it, or its own `on:` handlers
    // would never resolve (the delegated dispatch picks the table of the NEAREST registered instance).
    if (v.handlers) adoptTarget!.register(viewRoot as Element, v.handlers, vctx as Record<string, unknown>);
    const frag: DocumentFragment = document.createDocumentFragment();
    frag.append(...nodes);
    return frag;
  };

  let adoptFirst: boolean = adopting; // only the initially-matched view adopts; everything after renders
  const thunks: Map<Component, () => Node> = new Map<Component, () => Node>();
  ifBlock(anchorNode, () => {
    const m: Match | null = router?.matched(depth) ?? null;
    if (!m) return null;
    let thunk: (() => Node) | undefined = thunks.get(m.view);
    if (!thunk) {
      const view: Component = m.view;
      const loaderMatch: Match = m; // loader fn is stable per route; params are read live
      // Adopt applies to this thunk's FIRST call only. Keeping ONE thunk per view (rather than a separate
      // adopt thunk) preserves the reference stability ifBlock dedupes on — so a param-only change still
      // updates in place — while a navigate-away-and-back re-renders this view fresh.
      let adoptOnce: boolean = adoptFirst;
      adoptFirst = false;
      thunk = () => {
        if (adoptOnce) {
          adoptOnce = false;
          const adopted: Node | null = adoptView(view);
          if (adopted) return adopted; // resumed in place — the view's setup never re-ran
        }
        // Run this route's loader (if any) and expose it via context so a descendant's
        // useLoaderData() resolves it. Provided in the branch's own owner scope, so it
        // disposes with the view on swap/unmount.
        if (loaderMatch.loader && getOwner()) {
          provide(LoaderDataContext, createLoaderResource(loaderMatch, router!, depth));
        }
        const node: Node = view({
          get params() {
            return router!.params(depth);
          },
          // Phase E: tag the view so a resumable build registers its ctx under a SERVER↔CLIENT-stable id.
          // The path picks the same match on both sides, so depth identifies it. Inert in an eager build
          // (nothing reads `$wid`) and on the client (registerState no-ops outside a collect session).
          $wid: routeStateId(depth),
        } as Record<string, unknown>);
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

/** The snapshot id a routed view's ctx is registered under — stable across server + client (E1.12). */
function routeStateId(depth: number): string {
  return `$route:${depth}`;
}

// This outlet resumes through its own render (it needs its live `router` prop), not from a snapshot ctx.
(RouterView as Component & { adoptsSelf?: boolean }).adoptsSelf = true;

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
