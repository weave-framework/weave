/**
 * The docs router — built from the file-based route manifest that `weave` generates
 * from `src/pages/` (config `routesDir`). Drop a page file under `src/pages/` and it
 * becomes a route; `routes.gen.ts` is regenerated on every dev/build and git-ignored.
 *
 *   index.*               → '/'
 *   learn/introduction.*  → '/learn/introduction'
 *   reference/[pkg].*      → '/reference/:pkg'
 *   [...rest].*           → '*'   (404 fallback)
 */

import { createRouter, type Router } from '@weave-framework/router';
import { routes } from '../pages/routes.gen';

// Base path for hosting under a sub-path (e.g. GitHub Pages project page). The
// build's postbuild step injects a `<base href>` for that case; in dev it's absent,
// so we default to root. setBasename normalizes '/weave/' → '/weave', '/' → ''.
const baseHref: string =
  (typeof document !== 'undefined' && document.querySelector('base')?.getAttribute('href')) || '/';

export { routes };
export const router: Router = createRouter(routes, { basename: baseHref });
