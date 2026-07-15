import { test, assert } from '../../../tools/harness.js';
import { signal, effect, type Signal } from '@weave-framework/runtime';
import { serialize, deserialize, SerializeError } from '@weave-framework/runtime/serialize';
import { handlerAttr } from '@weave-framework/runtime/resume';
import { snapshot, resume, collectStates, registerState, ROOT_ID } from '@weave-framework/runtime/graph';

/**
 * E0.3 — the resume entry (`@weave-framework/runtime/graph`). Rebuild a component's reactive state from a
 * serialized snapshot and wire handlers lazily, WITHOUT re-running `setup` (RFC 0009 §3). Importing `graph`
 * registers the `signal` (de)serializer, so a reactive-state record round-trips. These tests pin: the
 * signal codec, the setup-never-called invariant (resumed, not hydrated), and a full resumed-click loop.
 */

const asSig = <T>(v: unknown): Signal<T> => v as Signal<T>;
const isLiveSignal = (v: unknown): boolean =>
  typeof v === 'function' && typeof (v as { peek?: unknown }).peek === 'function' && typeof (v as { set?: unknown }).set === 'function';

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ── the signal codec (serialize now claims a signal; a plain function still throws) ── */

test('graph: a signal round-trips as a fresh LIVE signal carrying the server value', () => {
  const s: Signal<{ n: number; when: Date }> = signal({ n: 1, when: new Date(0) });
  const ctx = deserialize(snapshot({ s })) as { s: Signal<{ n: number; when: Date }> };

  assert.ok(isLiveSignal(ctx.s), 'decoded back to a live signal (callable with .set/.peek)');
  assert.ok(ctx.s !== s, 'a FRESH signal, not the same instance');
  assert.equal(ctx.s().n, 1, 'value preserved');
  assert.ok(ctx.s().when instanceof Date && ctx.s().when.getTime() === 0, 'nested typed leaf (Date) preserved');

  let seen: number = 0;
  effect(() => {
    ctx.s();
    seen++;
  });
  ctx.s.set({ n: 2, when: new Date(0) });
  assert.equal(seen, 2, 'the resumed signal is writable AND reactive — an effect re-ran');
});

test('serialize: the codec claims a signal (a function) but an unclaimed function still throws', () => {
  const out: unknown = deserialize(serialize(signal(7)));
  assert.ok(isLiveSignal(out) && asSig<number>(out)() === 7, 'a bare signal serializes + restores');
  let threw: boolean = false;
  try {
    serialize(() => 1);
  } catch (e) {
    threw = e instanceof SerializeError;
  }
  assert.ok(threw, 'a plain (unclaimed) function is still a SerializeError — the guard is intact');
});

/* ── E1.2c-6.1: per-instance state collection (the multi-component snapshot map) ── */

test('collectStates: gathers each registered component ctx into one map, keyed by id; no-op outside a session', () => {
  registerState('c9', { x: signal(1) }); // outside a session → dropped, no throw
  const a: Signal<number> = signal(1);
  const b: Signal<string> = signal('b');
  const states = collectStates(() => {
    registerState('c0', { a });
    registerState('c1', { b });
  });
  assert.deepEqual(Object.keys(states).sort(), ['c0', 'c1'], 'only the in-session registrations are collected');
  assert.is((states.c0 as { a: Signal<number> }).a, a, 'the ctx is stored by reference');
  // the session is restored after collectStates returns → a later registerState is again a no-op
  registerState('c2', { late: signal(9) });
  const empty = collectStates(() => {});
  assert.deepEqual(Object.keys(empty), [], 'the collector reset — a post-session registerState leaked nothing');
});

test('registerState: drops raw handler functions (not state) but keeps signals — so the ctx serializes', () => {
  const count: Signal<number> = signal(2);
  const inc = (): void => count.set((n) => n + 1);
  const states = collectStates(() => {
    registerState('c0', { count, inc, label: 'hi' });
  });
  const c0 = states.c0 as Record<string, unknown>;
  assert.is(c0.count, count, 'the writable signal is kept (it IS state)');
  assert.equal(c0.label, 'hi', 'plain data is kept');
  assert.ok(!('inc' in c0), 'the handler function was dropped (re-derived on the client, and unserializable)');
  // proof the captured ctx now crosses the wire (a raw function would have thrown in serialize)
  const back = deserialize(snapshot(states)) as Record<string, Record<string, unknown>>;
  assert.ok(typeof back.c0.count === 'function' && (back.c0.count as Signal<number>)() === 2, 'the filtered ctx round-trips (count @ 2)');
});

test('collectStates: the whole map snapshots + resumes, sharing a signal across components by structural sharing', () => {
  // a signal SHARED by two component instances (e.g. a store) must deserialize to ONE instance, not two
  const shared: Signal<number> = signal(10);
  const states = collectStates(() => {
    registerState('c0', { own: signal('a'), shared });
    registerState('c1', { own: signal('b'), shared });
  });
  states[ROOT_ID] = { title: signal('root') };

  const back = deserialize(snapshot(states)) as Record<string, Record<string, Signal<unknown>>>;
  assert.deepEqual(Object.keys(back).sort(), ['c0', 'c1', ROOT_ID].sort(), 'root + both instances round-trip');
  assert.ok(isLiveSignal(back.c0.own) && isLiveSignal(back[ROOT_ID].title), 'each ctx rebuilt with live signals');
  assert.is(back.c0.shared, back.c1.shared, 'the shared signal deserialized to ONE instance (structural sharing held)');
  assert.ok(back.c0.own !== back.c1.own, 'the per-instance signals stayed distinct');

  // the shared, resumed signal is reactive and drives both consumers
  let seen = 0;
  effect(() => { (back.c1.shared as Signal<number>)(); seen++; });
  (back.c0.shared as Signal<number>).set(11);
  assert.equal(seen, 2, 'writing the shared signal via one instance re-runs an effect reading it via the other');
});

/* ── the resumability invariant + a full resumed click ── */

test('resume: rebuilds the graph + wires a lazy handler WITHOUT calling setup (resumed, not hydrated)', () => {
  // ── server ── run setup ONCE, snapshot its reactive state, render HTML with the resumable marker
  let setupCalls: number = 0;
  const setup = (): { count: Signal<number> } => {
    setupCalls++;
    return { count: signal(5) };
  };
  const serverCtx: { count: Signal<number> } = setup();
  assert.equal(setupCalls, 1, 'server ran setup once');
  const wire = snapshot({ count: serverCtx.count });
  const html: string = `<button ${handlerAttr('click')}="w0#0">inc</button>`;

  // ── client ── parse server HTML, resume; setup must NEVER be called here
  const root: HTMLElement = host();
  root.innerHTML = html;
  const app = resume(root, {
    snapshot: wire,
    handlers: (c) => ({ w0: () => asSig<number>(c.count).set((n) => n + 1) }),
  });

  assert.equal(setupCalls, 1, 'setup was NOT called on the client — the resumability invariant');
  assert.equal(asSig<number>(app.ctx.count)(), 5, 'the resumed signal carries the server value');

  // a demonstrative binding proves the resumed graph is LIVE and drives the adopted DOM
  const out: HTMLSpanElement = document.createElement('span');
  root.appendChild(out);
  effect(() => {
    out.textContent = String(asSig<number>(app.ctx.count)());
  });
  assert.equal(out.textContent, '5', 'binding reflects the resumed value');

  const btn: HTMLButtonElement = root.querySelector('button') as HTMLButtonElement;
  btn.click(); // first interaction → lazy resolve (by site prefix w0#0 → w0) + invoke
  assert.equal(asSig<number>(app.ctx.count)(), 6, 'the resumed handler mutated the resumed signal');
  assert.equal(out.textContent, '6', 'reactivity flows after resume — the DOM updated with no setup re-run');
  app.dispose();
});

test('resume: an exact id wins over the site prefix, and a bare id resolves', () => {
  const root: HTMLElement = host();
  root.innerHTML =
    `<button id="a" ${handlerAttr('click')}="w0#0">a</button>` +
    `<button id="b" ${handlerAttr('click')}="bare">b</button>`;
  const hits: string[] = [];
  const app = resume(root, {
    snapshot: snapshot({}),
    handlers: () => ({
      'w0#0': () => hits.push('exact'), // exact instance id present → must win over the 'w0' site
      w0: () => hits.push('site'),
      bare: () => hits.push('bare'),
    }),
  });
  (root.querySelector('#a') as HTMLButtonElement).click();
  (root.querySelector('#b') as HTMLButtonElement).click();
  assert.deepEqual(hits, ['exact', 'bare'], 'exact-id match preferred; a bare (no #) ref resolves directly');
  app.dispose();
});
