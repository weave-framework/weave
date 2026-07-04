import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, parseTemplate } from '@weave-framework/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown> = {}, scope: string[] = []): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  return fn(ctx, rt, {});
}
function host(el: Element): HTMLElement {
  const h: HTMLDivElement = document.createElement('div');
  h.appendChild(el);
  document.body.appendChild(h);
  return h;
}
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0)); // drains microtasks

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise: Promise<T> = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* a resource is anything with signal-backed loading/data/error accessors */
function mockResource<T>(
  init: { loading?: boolean; data?: T; error?: unknown } = {}
): { loading: Signal<boolean>; data: Signal<T | undefined>; error: Signal<unknown> } {
  return {
    loading: signal(init.loading ?? false),
    data: signal<T | undefined>(init.data),
    error: signal<unknown>(init.error),
  };
}

/* ──────────────────────────── parse ──────────────────────────── */

test('parses @await with pending + @then(alias) + @catch(alias)', () => {
  const [node] = parseTemplate('@await (p) { <i>w</i> } @then (u) { <b>{{ u }}</b> } @catch (e) { <s>{{ e }}</s> }');
  assert.equal(node.type, 'await');
  if (node.type !== 'await') return;
  assert.equal(node.expr, 'p');
  assert.ok(node.pending, 'has pending');
  assert.equal(node.then?.alias, 'u');
  assert.equal(node.catch?.alias, 'e');
});

/* ──────────────────────────── Promise ──────────────────────────── */

test('Promise: pending → then(value) on resolve', async () => {
  const d: { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void } = deferred<string>();
  const h: HTMLElement = host(
    render(
      '<div>@await (p) { <span class="l">loading</span> } @then (u) { <b class="d">{{ u }}</b> } @catch (e) { <i class="e">{{ e }}</i> }</div>',
      { p: d.promise },
      ['p']
    )
  );
  assert.ok(h.querySelector('.l'), 'pending content shown first');
  assert.equal(h.querySelector('.d'), null);

  d.resolve('hi');
  await flush();
  assert.equal(h.querySelector('.l'), null, 'pending removed');
  assert.equal(h.querySelector('.d')?.textContent, 'hi', 'then renders the resolved value');
  h.remove();
});

test('Promise: pending → catch(error) on reject', async () => {
  const d: { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void } = deferred<string>();
  const h: HTMLElement = host(
    render(
      '<div>@await (p) { <span class="l">loading</span> } @then (u) { <b class="d">{{ u }}</b> } @catch (e) { <i class="e">{{ e }}</i> }</div>',
      { p: d.promise },
      ['p']
    )
  );
  d.reject('boom');
  await flush();
  assert.equal(h.querySelector('.d'), null);
  assert.equal(h.querySelector('.e')?.textContent, 'boom', 'catch renders the error');
  h.remove();
});

test('Promise: a plain (non-thenable) value resolves into @then', async () => {
  const h: HTMLElement = host(render('<div>@await (v) @then (u) { <b class="d">{{ u }}</b> }</div>', { v: 42 }, ['v']));
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, '42');
  h.remove();
});

test('Promise: a reactive source re-awaits when its dependency changes', async () => {
  const id: Signal<number> = signal(1);
  const store: Record<number, { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void }> = {
    1: deferred<string>(),
    2: deferred<string>(),
  };
  const fetchUser = (uid: number): Promise<string> => store[uid].promise;
  const h: HTMLElement = host(
    render(
      '<div>@await (fetchUser(id())) { <span class="l">loading</span> } @then (u) { <b class="d">{{ u }}</b> } @catch (e) { <i class="e">{{ e }}</i> }</div>',
      { fetchUser, id },
      ['fetchUser', 'id']
    )
  );
  assert.ok(h.querySelector('.l'), 'pending for user 1');
  store[1].resolve('Alice');
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, 'Alice', 'then renders user 1');

  // change the dependency → the block must re-enter pending and await the NEW promise
  id.set(2);
  assert.ok(h.querySelector('.l'), 'reactive source re-entered pending for user 2');
  assert.equal(h.querySelector('.d'), null, 'stale value cleared');
  store[2].resolve('Bob');
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, 'Bob', 'then re-renders with the new value');
  h.remove();
});

test('Promise: a stale resolution after the source changed is ignored', async () => {
  const id: Signal<number> = signal(1);
  const store: Record<number, { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void }> = {
    1: deferred<string>(),
    2: deferred<string>(),
  };
  const fetchUser = (uid: number): Promise<string> => store[uid].promise;
  const h: HTMLElement = host(
    render(
      '<div>@await (fetchUser(id())) @then (u) { <b class="d">{{ u }}</b> }</div>',
      { fetchUser, id },
      ['fetchUser', 'id']
    )
  );
  id.set(2); // switch before the first ever resolves
  store[2].resolve('current');
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, 'current');
  store[1].resolve('stale'); // the superseded promise resolves late
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, 'current', 'stale resolution did not clobber');
  h.remove();
});

/* ──────────────────────────── resource ──────────────────────────── */

test('resource: loading → then, driven off its signals', async () => {
  const r: { loading: Signal<boolean>; data: Signal<string | undefined>; error: Signal<unknown> } = mockResource<string>({ loading: true });
  const h: HTMLElement = host(
    render('<div>@await (r) { <span class="l">…</span> } @then (u) { <b class="d">{{ u }}</b> }</div>', { r }, ['r'])
  );
  assert.ok(h.querySelector('.l'), 'loading shows pending');

  r.data.set('X');
  r.loading.set(false);
  assert.equal(h.querySelector('.l'), null);
  assert.equal(h.querySelector('.d')?.textContent, 'X', 'then shows resource data');
  h.remove();
});

test('resource: error() routes to @catch', async () => {
  const r: { loading: Signal<boolean>; data: Signal<string | undefined>; error: Signal<unknown> } = mockResource<string>({ loading: true });
  const h: HTMLElement = host(
    render(
      '<div>@await (r) { <span class="l">…</span> } @then (u) { <b class="d">{{ u }}</b> } @catch (e) { <i class="e">{{ e }}</i> }</div>',
      { r },
      ['r']
    )
  );
  r.error.set('failed');
  r.loading.set(false);
  assert.equal(h.querySelector('.e')?.textContent, 'failed');
  assert.equal(h.querySelector('.d'), null);
  h.remove();
});

test('resource: a refetch (loading again) shows pending, then the new value', async () => {
  const r: { loading: Signal<boolean>; data: Signal<string | undefined>; error: Signal<unknown> } = mockResource<string>({ loading: false, data: 'first' });
  const h: HTMLElement = host(
    render('<div>@await (r) { <span class="l">…</span> } @then (u) { <b class="d">{{ u }}</b> }</div>', { r }, ['r'])
  );
  assert.equal(h.querySelector('.d')?.textContent, 'first');

  r.loading.set(true); // refetch
  assert.ok(h.querySelector('.l'), 'pending shown again during refetch');
  assert.equal(h.querySelector('.d'), null);

  r.data.set('second');
  r.loading.set(false);
  assert.equal(h.querySelector('.d')?.textContent, 'second', 'then re-renders with the new value');
  h.remove();
});

/* ──────────────────────────── optional parts ──────────────────────────── */

test('no pending block: nothing renders until @then', async () => {
  const d: { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void } = deferred<string>();
  const h: HTMLElement = host(render('<div>@await (p) @then (u) { <b class="d">{{ u }}</b> }</div>', { p: d.promise }, ['p']));
  assert.equal(h.querySelector('.d'), null, 'nothing while pending (no pending block)');
  d.resolve('ok');
  await flush();
  assert.equal(h.querySelector('.d')?.textContent, 'ok');
  h.remove();
});

test('no @then/@catch: pending content clears once settled', async () => {
  const d: { promise: Promise<string>; resolve: (v: string) => void; reject: (e: unknown) => void } = deferred<string>();
  const h: HTMLElement = host(render('<div>@await (p) { <span class="l">loading</span> }</div>', { p: d.promise }, ['p']));
  assert.ok(h.querySelector('.l'));
  d.resolve('whatever');
  await flush();
  assert.equal(h.querySelector('.l'), null, 'pending removed; nothing to render on fulfill');
  h.remove();
});
