import { test, assert } from '../../../tools/harness.js';
import { defineComponent, mountComponent, lazy } from '@weave/runtime/dom';

/** Flush all microtasks (the loader promise settles across a few of them). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

function span(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('lazy shows the loading fallback, then swaps to the resolved component', async () => {
  const Real = defineComponent(() => span('real'));
  const Loading = defineComponent(() => span('loading…'));
  const L = lazy(() => Promise.resolve({ default: Real }), { loading: Loading });
  const el = host();
  mountComponent(L, el);
  assert.ok(el.textContent?.includes('loading'), 'loading fallback shown first');
  await settle();
  assert.ok(el.textContent?.includes('real'), 'swapped to the real component');
  assert.ok(!el.textContent?.includes('loading'), 'loading fallback removed');
  el.remove();
});

test('lazy accepts a promise resolving directly to a component (no default wrapper)', async () => {
  const Real = defineComponent(() => span('direct'));
  const L = lazy(() => Promise.resolve(Real));
  const el = host();
  mountComponent(L, el);
  await settle();
  assert.ok(el.textContent?.includes('direct'));
  el.remove();
});

test('lazy forwards props to the resolved component', async () => {
  const Greet = defineComponent((props) => span('hi ' + String(props.name)));
  const L = lazy(() => Promise.resolve({ default: Greet }));
  const el = host();
  mountComponent(L, el, { name: 'Aidas' });
  await settle();
  assert.ok(el.textContent?.includes('hi Aidas'), 'props reached the lazy-loaded component');
  el.remove();
});

test('lazy renders the error fallback when the loader rejects', async () => {
  const L = lazy(() => Promise.reject(new Error('nope')), {
    error: (e) => span('error:' + (e as Error).message),
  });
  const el = host();
  mountComponent(L, el);
  await settle();
  assert.ok(el.textContent?.includes('error:nope'));
  el.remove();
});

test('lazy loads once and shares the result across instances', async () => {
  let calls = 0;
  const Real = defineComponent(() => span('x'));
  const L = lazy(() => {
    calls++;
    return Promise.resolve({ default: Real });
  });
  const a = host();
  const b = host();
  mountComponent(L, a);
  mountComponent(L, b);
  await settle();
  assert.equal(calls, 1, 'loader invoked once for all instances');
  assert.ok(a.textContent?.includes('x') && b.textContent?.includes('x'), 'both render');
  a.remove();
  b.remove();
});

test('lazy renders immediately (no loading flash) once already loaded', async () => {
  const Real = defineComponent(() => span('cached'));
  const Loading = defineComponent(() => span('spinner'));
  const L = lazy(() => Promise.resolve({ default: Real }), { loading: Loading });
  const warm = host();
  mountComponent(L, warm); // first mount kicks off + completes the load
  await settle();
  warm.remove();

  const el = host();
  mountComponent(L, el); // second mount — cache is warm
  assert.ok(el.textContent?.includes('cached'), 'real component shown synchronously');
  assert.ok(!el.textContent?.includes('spinner'), 'no loading flash');
  el.remove();
});
