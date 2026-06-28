// @ts-check
/**
 * Weave — official router (built in, not a third-party bolt-on).
 *
 * History-based, signal-driven. The current path is a signal, so any view that
 * reads it updates surgically on navigation. Supports path params (`/user/:id`)
 * and a 404 fallback. Answers the "official routing" wish from the analysis.
 */

import { signal, computed } from './reactive.js';
import { html } from './dom.js';

const path = signal(typeof location !== 'undefined' ? location.pathname : '/');

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => path.set(location.pathname));
}

/** Reactive current pathname. */
export const currentPath = path;

/** Programmatic navigation (pushes history). @param {string} to */
export function navigate(to) {
  if (to === path.peek()) return;
  history.pushState(null, '', to);
  path.set(to);
}

/**
 * An anchor that navigates client-side instead of reloading.
 *   html`${link('/about', 'About')}`
 * @param {string} to
 * @param {any} children
 * @param {Record<string, any>} [attrs]
 */
export function link(to, children, attrs = {}) {
  const a = html`<a href=${to}>${children}</a>`.firstChild;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  });
  return a;
}

/** Compile `/user/:id` into a matcher returning params or null. */
function compileRoute(pattern) {
  const keys = [];
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
    const params = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return params;
  };
}

/**
 * Define a router. `routes` maps a path pattern to a view factory `(params) => Node`.
 * Use `'*'` for a 404 fallback. Returns a reactive view function for `html`.
 *   html`<main>${router({ '/': Home, '/user/:id': UserPage, '*': NotFound })}</main>`
 * @param {Record<string, (params: any) => any>} routes
 * @returns {() => any}
 */
export function router(routes) {
  const compiled = Object.entries(routes)
    .filter(([p]) => p !== '*')
    .map(([p, view]) => ({ match: compileRoute(p), view }));
  const fallback = routes['*'];

  const match = computed(() => {
    const p = path();
    for (const r of compiled) {
      const params = r.match(p);
      if (params) return { view: r.view, params };
    }
    return fallback ? { view: fallback, params: {} } : null;
  });

  return () => {
    const m = match();
    return m ? m.view(m.params) : null;
  };
}
