/**
 * The app router. Routes are code-split via `lazy()` — each page is its own chunk,
 * which the router's <Link> prefetch (B.15) warms on hover. Phase D's later
 * file-based-routing step replaces this hand-written table with a generated one.
 */

import { createRouter, type Route } from '@weave/router';
import { lazy } from '@weave/runtime/dom';

const Board = lazy(() => import('../pages/board/board'));
const TaskDetail = lazy(() => import('../pages/task-detail/task-detail'));
const Boom = lazy(() => import('../pages/boom/boom'));

export const routes: Route[] = [
  { path: '', component: Board },
  { path: 'task/:id', component: TaskDetail },
  { path: 'boom', component: Boom },
];

export const router = createRouter(routes);
