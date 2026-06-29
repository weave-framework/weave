/**
 * The app router — built from the file-based route manifest that `weave routes`
 * generates from `src/pages/` (config `routesDir`). Drop a page file under
 * `src/pages/` and it becomes a route; there is no central table to edit here.
 *
 *   index.{ts,html,scss}     → '/'          (the board)
 *   stress.{ts,html,scss}    → '/stress'
 *   boom.ts                  → '/boom'
 *   task/[id].{ts,html,scss} → '/task/:id'
 *   [...rest].{ts,html,scss} → '*'          (404 fallback)
 *
 * `routes.gen.ts` is regenerated on every `weave dev`/`build` and is git-ignored.
 */

import { createRouter, type Router } from '@weave/router';
import { routes } from '../pages/routes.gen';

export { routes };
export const router: Router = createRouter(routes);
