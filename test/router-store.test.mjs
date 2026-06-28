import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Node = dom.window.Node;
globalThis.DocumentFragment = dom.window.DocumentFragment;

const { signal, computed } = await import('../src/reactive.js');
const { html, mount } = await import('../src/dom.js');
const { router, navigate, link } = await import('../src/router.js');
const { store } = await import('../src/store.js');

function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('router renders matching route and updates on navigate', () => {
  const el = container();
  const Home = () => html`<h1>Home</h1>`;
  const User = (p) => html`<h1>User ${p.id}</h1>`;
  const NotFound = () => html`<h1>404</h1>`;
  mount(html`<main>${router({ '/': Home, '/user/:id': User, '*': NotFound })}</main>`, el);

  navigate('/');
  assert.equal(el.querySelector('h1').textContent, 'Home');

  navigate('/user/42');
  assert.equal(el.querySelector('h1').textContent, 'User 42');

  navigate('/nope');
  assert.equal(el.querySelector('h1').textContent, '404');
});

test('link() navigates client-side without reload', () => {
  const el = container();
  const Home = () => html`<h1>Home</h1>`;
  const About = () => html`<h1>About</h1>`;
  navigate('/');
  mount(html`<div>${link('/about', 'Go')}${router({ '/': Home, '/about': About })}</div>`, el);
  assert.equal(el.querySelector('h1').textContent, 'Home');
  const a = el.querySelector('a');
  assert.equal(a.getAttribute('href'), '/about');
  a.dispatchEvent(new dom.window.MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
  assert.equal(el.querySelector('h1').textContent, 'About');
});

test('store is a lazy singleton of signals', () => {
  const useCounter = store(() => {
    const count = signal(0);
    const doubled = computed(() => count() * 2);
    return { count, doubled, inc: () => count.set((c) => c + 1) };
  });
  const a = useCounter();
  const b = useCounter();
  assert.equal(a, b, 'same singleton instance');
  a.inc();
  assert.equal(b.count(), 1);
  assert.equal(b.doubled(), 2);
});

test('store drives DOM across components', () => {
  const el = container();
  const useCart = store(() => {
    const items = signal([]);
    const total = computed(() => items().reduce((s, i) => s + i, 0));
    return { items, total, add: (n) => items.set((xs) => [...xs, n]) };
  });
  const Total = () => { const c = useCart(); return html`<b>${c.total}</b>`; };
  const AddBtn = () => { const c = useCart(); return html`<button onclick=${() => c.add(5)}>+</button>`; };
  mount(html`<div>${Total()}${AddBtn()}</div>`, el);
  assert.equal(el.querySelector('b').textContent, '0');
  el.querySelector('button').dispatchEvent(new dom.window.Event('click'));
  el.querySelector('button').dispatchEvent(new dom.window.Event('click'));
  assert.equal(el.querySelector('b').textContent, '10');
});
