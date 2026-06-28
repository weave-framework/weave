/**
 * The app router. For D.1 the route table is written by hand; phase D.3 swaps it
 * for a `weave routes`-generated module (file-based routing) over `src/routes/`.
 */

import { createRouter, type Route } from '@weave/router';
import Board from './routes/index';

export const routes: Route[] = [{ path: '', component: Board }];

export const router = createRouter(routes);
