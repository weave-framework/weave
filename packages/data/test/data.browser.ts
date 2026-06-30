import { test, assert } from '../../../tools/harness.js';
import { signal, root } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';
import { resource, createClient, HttpError, action, optimistic } from '@weave-framework/data';
import type { Resource, Client, Action, Optimistic } from '@weave-framework/data';

/** Flush all pending microtasks (resource defers its fetch + chains two .then). */
const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

/** Await until a predicate holds — robust to real `Response.json()` resolving across ticks. */
async function until(pred: () => boolean, tries: number = 50): Promise<void> {
  for (let i: number = 0; i < tries && !pred(); i++) await tick();
}

/** A promise whose resolve/reject are available synchronously. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise: Promise<T> = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/* ──────────────────────────── resource ──────────────────────────── */

test('resource: loading starts true, then data resolves', async () => {
  const d: ReturnType<typeof deferred<number>> = deferred<number>();
  const r: Resource<number> = resource(() => d.promise);
  assert.equal(r.loading(), true, 'loading true while pending');
  assert.equal(r.data(), undefined);

  d.resolve(42);
  await tick();
  assert.equal(r.loading(), false);
  assert.equal(r.data(), 42);
  assert.equal(r.error(), undefined);
});

test('resource: refetches when the source changes, aborting the previous request', async () => {
  const id: Signal<number> = signal(1);
  const seen: number[] = [];
  const signals: AbortSignal[] = [];
  const r: Resource<string> = resource(
    () => id(),
    (n, { signal }) => {
      seen.push(n);
      signals.push(signal);
      return Promise.resolve(`item-${n}`);
    }
  );

  await tick();
  assert.equal(r.data(), 'item-1');

  id.set(2);
  await tick();
  assert.equal(r.data(), 'item-2');
  assert.deepEqual(seen, [1, 2]);
  assert.equal(signals[0].aborted, true, 'previous request aborted on source change');
  assert.equal(signals[1].aborted, false);
});

test('resource: a stale in-flight result never overwrites a newer one', async () => {
  const id: Signal<number> = signal(1);
  const d1: ReturnType<typeof deferred<string>> = deferred<string>();
  const d2: ReturnType<typeof deferred<string>> = deferred<string>();
  const r: Resource<string> = resource(
    () => id(),
    (n) => (n === 1 ? d1.promise : d2.promise)
  );

  await tick();
  id.set(2);
  await tick();
  d2.resolve('second');
  await tick();
  d1.resolve('first'); // stale, arrives last
  await tick();
  assert.equal(r.data(), 'second', 'stale (aborted) result is ignored');
});

test('resource: a not-ready source (null) skips the fetch', async () => {
  const id: Signal<number | null> = signal<number | null>(null);
  let calls: number = 0;
  const r: Resource<number> = resource(
    () => id(),
    (n) => {
      calls++;
      return Promise.resolve(n * 2);
    }
  );

  await tick();
  assert.equal(calls, 0, 'not fetched while source is null');
  assert.equal(r.loading(), false);

  id.set(5);
  await tick();
  assert.equal(calls, 1);
  assert.equal(r.data(), 10);
});

test('resource: a rejection lands in error() and clears loading', async () => {
  const d: ReturnType<typeof deferred<number>> = deferred<number>();
  const r: Resource<number> = resource(() => d.promise);

  d.reject(new Error('boom'));
  await tick();
  assert.equal(r.loading(), false);
  assert.equal((r.error() as Error).message, 'boom');
  assert.equal(r.data(), undefined);
});

test('resource: refetch() re-runs the fetcher with the same source', async () => {
  let calls: number = 0;
  const r: Resource<number> = resource(
    () => true,
    () => Promise.resolve(++calls)
  );

  await tick();
  assert.equal(r.data(), 1);

  r.refetch();
  await tick();
  assert.equal(r.data(), 2);
  assert.equal(calls, 2);
});

test('resource: mutate() sets data without fetching', async () => {
  let calls: number = 0;
  const r: Resource<number> = resource(
    () => true,
    () => Promise.resolve(++calls)
  );

  await tick();
  assert.equal(r.data(), 1);

  r.mutate(99);
  assert.equal(r.data(), 99);
  assert.equal(calls, 1, 'mutate did not trigger a fetch');
});

test('resource: initialValue is returned before the first resolve', async () => {
  const d: ReturnType<typeof deferred<string>> = deferred<string>();
  const r: Resource<string> = resource(() => d.promise, { initialValue: 'seed' });
  assert.equal(r.data(), 'seed');

  d.resolve('real');
  await tick();
  assert.equal(r.data(), 'real');
});

test('resource: disposing the owner aborts the in-flight request', async () => {
  let captured!: AbortSignal;
  const dispose: () => void = root((d) => {
    resource((_v: true, { signal }) => {
      captured = signal;
      return new Promise<number>(() => {}); // never resolves
    });
    return d;
  });

  await tick();
  assert.equal(captured.aborted, false);
  dispose();
  assert.equal(captured.aborted, true, 'aborted when the owner is disposed (unmount)');
});

/* ──────────────────────────── createClient ──────────────────────────── */

test('client.get: applies baseUrl + params and parses JSON', async () => {
  let calledUrl: string = '';
  const client: Client = createClient({
    baseUrl: 'https://api.test',
    fetch: async (url) => {
      calledUrl = String(url);
      return jsonResponse({ ok: 1 });
    },
  });

  const out: { ok: number } = await client.get<{ ok: number }>('/items', {
    params: { page: 2, q: 'x' },
  });
  assert.equal(calledUrl, 'https://api.test/items?page=2&q=x');
  assert.deepEqual(out, { ok: 1 });
});

test('client.post: sends a JSON body with Content-Type and default headers', async () => {
  let init!: RequestInit;
  const client: Client = createClient({
    headers: { Authorization: 'Bearer t' },
    fetch: async (_url, i) => {
      init = i!;
      return jsonResponse({ id: 7 });
    },
  });

  const out: { id: number } = await client.post<{ id: number }>('/u', { name: 'A' });
  const h: Headers = new Headers(init.headers);
  assert.equal(h.get('content-type'), 'application/json');
  assert.equal(h.get('authorization'), 'Bearer t');
  assert.equal(init.body, JSON.stringify({ name: 'A' }));
  assert.equal(init.method, 'POST');
  assert.deepEqual(out, { id: 7 });
});

test('client: a non-2xx response throws HttpError and calls onError', async () => {
  let caught: unknown;
  const client: Client = createClient({
    onError: (e) => (caught = e),
    fetch: async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
  });

  let err: unknown;
  try {
    await client.get('/missing');
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof HttpError, 'threw an HttpError');
  assert.equal((err as HttpError).status, 404);
  assert.is(caught, err, 'onError received the same error');
});

test('client: a headers function is evaluated per request', async () => {
  let token: number = 1;
  let seen: string = '';
  const client: Client = createClient({
    headers: () => ({ Authorization: `Bearer ${token}` }),
    fetch: async (_u, i) => {
      seen = new Headers(i!.headers).get('authorization') ?? '';
      return jsonResponse({});
    },
  });

  await client.get('/a');
  assert.equal(seen, 'Bearer 1');
  token = 2;
  await client.get('/a');
  assert.equal(seen, 'Bearer 2', 'header function re-evaluated');
});

test('resource + client: client.get works as a fetcher and receives the abort signal', async () => {
  let gotSignal: AbortSignal | undefined;
  const client: Client = createClient({
    fetch: async (_u, i) => {
      gotSignal = i?.signal ?? undefined;
      return jsonResponse({ v: 'hi' });
    },
  });

  const id: Signal<string> = signal('a');
  const r: Resource<unknown> = resource(
    () => id(),
    (key, { signal }) => client.get(`/x/${key}`, { signal })
  );

  await until(() => r.data() !== undefined);
  assert.deepEqual(r.data(), { v: 'hi' });
  assert.ok(gotSignal, 'client received the resource abort signal');
});

/* ──────────────────────────── interceptors ──────────────────────────── */

test('interceptor: mutates the request (auth header) before fetch', async () => {
  let seen: string = '';
  const client: Client = createClient({
    interceptors: [
      (req, next) => {
        req.headers.set('Authorization', 'Bearer xyz');
        return next(req);
      },
    ],
    fetch: async (_u, i) => {
      seen = new Headers(i!.headers).get('authorization') ?? '';
      return jsonResponse({ ok: 1 });
    },
  });

  await client.get('/a');
  assert.equal(seen, 'Bearer xyz', 'request interceptor set the header');
});

test('interceptor: can read the response after next() resolves', async () => {
  let observedStatus: number = 0;
  const client: Client = createClient({
    interceptors: [
      async (req, next) => {
        const res: Response = await next(req);
        observedStatus = res.status;
        return res;
      },
    ],
    fetch: async () => jsonResponse({ ok: 1 }, { status: 201 }),
  });

  await client.get('/a');
  assert.equal(observedStatus, 201, 'interceptor saw the response status');
});

test('interceptor: short-circuits (cache hit) without calling next', async () => {
  let fetched: number = 0;
  const client: Client = createClient({
    interceptors: [(_req, _next) => Promise.resolve(jsonResponse({ cached: true }))],
    fetch: async () => {
      fetched++;
      return jsonResponse({ cached: false });
    },
  });

  const out: { cached: boolean } = await client.get<{ cached: boolean }>('/a');
  assert.deepEqual(out, { cached: true });
  assert.equal(fetched, 0, 'real fetch was bypassed');
});

test('interceptor: can retry a failed request', async () => {
  let attempt: number = 0;
  const client: Client = createClient({
    interceptors: [
      async (req, next) => {
        let res: Response = await next(req);
        if (!res.ok) res = await next(req); // one retry
        return res;
      },
    ],
    fetch: async () => {
      attempt++;
      return attempt === 1
        ? new Response('err', { status: 500, statusText: 'Server Error' })
        : jsonResponse({ ok: 1 });
    },
  });

  const out: { ok: number } = await client.get<{ ok: number }>('/a');
  assert.equal(attempt, 2, 'retried once');
  assert.deepEqual(out, { ok: 1 });
});

test('interceptor: chain runs outermost-first on the way in, unwinds on the way out', async () => {
  const order: string[] = [];
  const client: Client = createClient({
    interceptors: [
      async (req, next) => {
        order.push('a:in');
        const res: Response = await next(req);
        order.push('a:out');
        return res;
      },
      async (req, next) => {
        order.push('b:in');
        const res: Response = await next(req);
        order.push('b:out');
        return res;
      },
    ],
    fetch: async () => {
      order.push('fetch');
      return jsonResponse({});
    },
  });

  await client.get('/a');
  assert.deepEqual(order, ['a:in', 'b:in', 'fetch', 'b:out', 'a:out']);
});

/* ──────────────────────────── action ──────────────────────────── */

test('action: pending toggles and result lands on resolve', async () => {
  const d: ReturnType<typeof deferred<string>> = deferred<string>();
  const a: Action<void, string> = action(() => d.promise);
  assert.equal(a.pending(), false);
  assert.equal(a.result(), undefined);

  const p: Promise<string> = a.run();
  assert.equal(a.pending(), true, 'pending while in flight');

  d.resolve('done');
  assert.equal(await p, 'done', 'run() resolves with the action result');
  assert.equal(a.pending(), false);
  assert.equal(a.result(), 'done');
  assert.equal(a.error(), undefined);
});

test('action: a rejection lands in error(), clears pending, and run() rejects', async () => {
  const d: ReturnType<typeof deferred<number>> = deferred<number>();
  const a: Action<void, number> = action(() => d.promise);

  const p: Promise<number> = a.run();
  d.reject(new Error('nope'));
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  assert.equal((caught as Error).message, 'nope', 'run() rejects with the error');
  assert.equal(a.pending(), false);
  assert.equal((a.error() as Error).message, 'nope');
  assert.equal(a.result(), undefined);
});

test('action: passes input through to the action fn', async () => {
  const a: Action<number, number> = action((n: number) => Promise.resolve(n * 2));
  assert.equal(await a.run(21), 42);
  assert.equal(a.result(), 42);
});

test('action: a stale (slow) run does not overwrite a newer run’s state', async () => {
  const d1: ReturnType<typeof deferred<string>> = deferred<string>();
  const d2: ReturnType<typeof deferred<string>> = deferred<string>();
  let call: number = 0;
  const a: Action<void, string> = action(() => (++call === 1 ? d1.promise : d2.promise));

  const p1: Promise<string> = a.run();
  const p2: Promise<string> = a.run();
  d2.resolve('second');
  await p2;
  assert.equal(a.result(), 'second');

  d1.resolve('first'); // stale — arrives last
  await p1;
  assert.equal(a.result(), 'second', 'newer result is preserved');
  assert.equal(a.pending(), false);
});

/* ──────────────────────────── optimistic ──────────────────────────── */

test('optimistic: add() overlays the base; default reducer replaces', () => {
  const base: Signal<string> = signal('saved');
  const o: Optimistic<string, string> = root((d) => {
    const opt: Optimistic<string, string> = optimistic(() => base());
    assert.equal(opt.value(), 'saved', 'starts at base');
    opt.add('typing…');
    assert.equal(opt.value(), 'typing…', 'optimistic value shown');
    d();
    return opt;
  });
  void o;
});

test('optimistic: a custom reducer folds adds in order (list append)', () => {
  const base: Signal<string[]> = signal<string[]>(['a']);
  root((d) => {
    const opt: Optimistic<string[], string> = optimistic<string[], string>(
      () => base(),
      (list, item) => [...list, item]
    );
    opt.add('b');
    opt.add('c');
    assert.deepEqual(opt.value(), ['a', 'b', 'c']);
    d();
  });
});

test('optimistic: overlay clears when the base reconciles (changes)', () => {
  const base: Signal<string> = signal('v1');
  root((d) => {
    const opt: Optimistic<string, string> = optimistic(() => base());
    opt.add('pending');
    assert.equal(opt.value(), 'pending');

    base.set('v2'); // the real value arrived → reconcile
    assert.equal(opt.value(), 'v2', 'overlay dropped, base shows through');
    d();
  });
});
