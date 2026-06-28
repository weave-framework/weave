/**
 * @weave/router — the official client router. Built in, not a third-party bolt-on.
 * Zero third-party dependencies (only `@weave/runtime`).
 *
 * History-based and signal-driven: the current path is a signal, so any view
 * that reads it updates surgically on navigation. Supports path params
 * (`/user/:id`) and a `'*'` 404 fallback. The Angular-flavored surface is a
 * `<RouterView>` outlet + `<Link>`, configured by `createRouter({ routes })`.
 */

import { signal, computed } from '@weave/runtime';
import { ifBlock, type Component } from '@weave/runtime/dom';

export type RouteParams = Record<string, string>;

/** Routes map a path pattern to a component. `'*'` is the 404 fallback. */
export type Routes = Record<string, Component>;

const path = signal(typeof location !== 'undefined' ? location.pathname : '/');

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => path.set(location.pathname));
}

/** The reactive current pathname (read-only). */
export const currentPath = (): string => path();

/** Programmatic navigation (pushes history). Resilient if the env blocks pushState. */
export function navigate(to: string): void {
  if (to === path.peek()) return;
  try {
    history.pushState(null, '', to);
  } catch {
    /* non-navigable environment (tests, sandboxes) — the signal stays authoritative */
  }
  path.set(to);
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
  /** The currently matched route (component + params), or null if nothing matched. */
  matched: () => Match | null;
  /** The current path params (reactive; `{}` when unmatched). */
  params: () => RouteParams;
}

/**
 * Build a router from a `{ pattern: Component }` map (`'*'` = 404 fallback).
 * Place its output with `<RouterView router={r}/>`.
 */
export function createRouter(routes: Routes): Router {
  const compiled = Object.entries(routes)
    .filter(([p]) => p !== '*')
    .map(([p, view]) => ({ match: compileRoute(p), view }));
  const fallback = routes['*'];

  const matched = computed<Match | null>(() => {
    const p = path();
    for (const r of compiled) {
      const params = r.match(p);
      if (params) return { view: r.view, params };
    }
    return fallback ? { view: fallback, params: {} } : null;
  });
  const params = (): RouteParams => matched()?.params ?? {};

  return { matched, params };
}

/**
 * Router outlet: renders the matched component reactively. A `display:contents`
 * host keeps it layout-neutral. A stable render thunk per component means a
 * param-only change (`/user/1` → `/user/2`) updates `params` in place instead of
 * remounting; switching to a different route swaps the component.
 *
 * Usage in a template: `<RouterView router={r}/>`.
 */
export const RouterView: Component = (props = {}) => {
  const router = (props as { router?: Router }).router;
  const host = document.createElement('div');
  host.style.display = 'contents';
  const anchorNode = document.createComment('router');
  host.appendChild(anchorNode);

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
