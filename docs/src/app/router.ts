/**
 * The docs router — built from the file-based route manifest that `weave` generates
 * from `src/pages/` (config `routesDir`). Drop a page file under `src/pages/` and it
 * becomes a route; `routes.gen.ts` is regenerated on every dev/build and git-ignored.
 *
 *   index.*               → '/'
 *   learn/introduction.*  → '/learn/introduction'
 *   reference/runtime.*   → '/reference/runtime'
 *   [...rest].*           → '*'   (404 fallback)
 */

import { createRouter, type Router } from '@weave/router';
import { routes } from '../pages/routes.gen';

export { routes };
export const router: Router = createRouter(routes);
