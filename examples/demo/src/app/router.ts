/**
 * The app router. Routes are code-split via `lazy()` — each page is its own chunk,
 * which the router's <Link> prefetch (B.15) warms on hover. Phase D's later
 * file-based-routing step replaces this hand-written table with a generated one.
 */

import { createRouter, type Route, type Router } from '@weave/router';
import { lazy, type Component } from '@weave/runtime/dom';

const Board: Component = lazy(() => import('../pages/board/board'));
const TaskDetail: Component = lazy(() => import('../pages/task-detail/task-detail'));
const Boom: Component = lazy(() => import('../pages/boom/boom'));

export const routes: Route[] = [
  { path: '', component: Board },
  { path: 'task/:id', component: TaskDetail },
  { path: 'boom', component: Boom },
];

export const router: Router = createRouter(routes);
