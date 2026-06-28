/**
 * Mock backend for the demo — an in-memory task "database" served through a fake
 * `fetch`. This lets the app run fully offline, yet still exercise the REAL
 * `@weave/data` stack: `createClient`, the functional interceptor chain
 * (auth + logging), and `resource`/`action` on top. Swapping `fetch` for the real
 * one is the only change a production app would make.
 */

import { createClient, type Interceptor } from '@weave/data';
import type { Task, NewTask } from '../types';

/* ──────────────────────────── in-memory db ──────────────────────────── */

let db: Task[] = [
  { id: 't1', title: 'Sketch the board layout', status: 'done', priority: 'med', assignee: 'Aidas' },
  { id: 't2', title: 'Wire the mock API client', status: 'done', priority: 'high', assignee: 'Aidas' },
  { id: 't3', title: 'Build the task card component', status: 'doing', priority: 'high', assignee: 'Lina' },
  { id: 't4', title: 'Add cross-field form validation', status: 'todo', priority: 'med' },
  { id: 't5', title: 'Drag-to-reorder with transitions', status: 'todo', priority: 'low', assignee: 'Lina' },
  { id: 't6', title: 'Write the Playwright integration test', status: 'todo', priority: 'high' },
];
let seq = db.length;

const LATENCY = 160; // ms — visible-but-snappy, so loading states actually show
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ──────────────────────────── fake fetch ──────────────────────────── */

/** A `fetch` whose responses come from the in-memory db. Matches `typeof fetch`. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = new URL(url, 'http://demo').pathname;
  await delay(LATENCY);

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (method === 'GET' && path === '/tasks') return json(db);

  if (method === 'POST' && path === '/tasks') {
    const input = init?.body ? (JSON.parse(init.body as string) as NewTask) : null;
    if (!input) return json({ error: 'missing body' }, 400);
    const task: Task = { ...input, id: `t${++seq}` };
    db = [...db, task];
    return json(task, 201);
  }

  const idMatch = /^\/tasks\/(.+)$/.exec(path);
  if (idMatch) {
    const id = idMatch[1];
    const task = db.find((t) => t.id === id);
    if (method === 'GET') return task ? json(task) : json({ error: 'not found' }, 404);
    if (!task) return json({ error: 'not found' }, 404);
    if (method === 'PATCH') {
      const patch = init?.body ? (JSON.parse(init.body as string) as Partial<Task>) : {};
      const updated = { ...task, ...patch, id };
      db = db.map((t) => (t.id === id ? updated : t));
      return json(updated);
    }
    if (method === 'DELETE') {
      db = db.filter((t) => t.id !== id);
      return json({ ok: true });
    }
  }

  return json({ error: `no route for ${method} ${path}` }, 404);
};

/* ──────────────────────────── interceptors ──────────────────────────── */

/** Attaches a (fake) bearer token to every request — the auth-header pattern. */
const authInterceptor: Interceptor = (req, next) => {
  req.headers.set('Authorization', 'Bearer demo-token');
  return next(req);
};

/** Logs every call + its resulting status to the console (open devtools to see). */
const loggingInterceptor: Interceptor = async (req, next) => {
  const res = await next(req);
  console.debug(`[api] ${req.method} ${new URL(req.url, 'http://demo').pathname} → ${res.status}`);
  return res;
};

/* ──────────────────────────── the client ──────────────────────────── */

/** The app-wide API client. Its methods drop straight into resources/actions. */
export const api = createClient({
  fetch: fakeFetch,
  interceptors: [loggingInterceptor, authInterceptor], // first = outermost
});
