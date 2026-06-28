import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Install a DOM into globals before importing the DOM layer.
before(() => {});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Node = dom.window.Node;
globalThis.DocumentFragment = dom.window.DocumentFragment;

const { signal, computed } = await import('../src/reactive.js');
const { html, when, each, mount } = await import('../src/dom.js');

function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('static template renders', () => {
  const el = container();
  mount(html`<p class="x">hi</p>`, el);
  assert.equal(el.innerHTML, '<p class="x">hi</p>');
});

test('reactive text updates surgically', () => {
  const el = container();
  const count = signal(0);
  mount(html`<span>${count}</span>`, el);
  assert.equal(el.textContent, '0');
  count.set(5);
  assert.equal(el.textContent, '5');
});

test('reactive expression interpolation', () => {
  const el = container();
  const a = signal(2);
  const b = signal(3);
  mount(html`<b>${() => a() + b()}</b>`, el);
  assert.equal(el.textContent, '5');
  a.set(10);
  assert.equal(el.textContent, '13');
});

test('attribute binding, static + dynamic mix', () => {
  const el = container();
  const color = signal('red');
  mount(html`<div class="box ${color}"></div>`, el);
  const div = el.querySelector('div');
  assert.equal(div.getAttribute('class'), 'box red');
  color.set('blue');
  assert.equal(div.getAttribute('class'), 'box blue');
});

test('boolean attribute toggles presence', () => {
  const el = container();
  const disabled = signal(true);
  mount(html`<button disabled=${disabled}>go</button>`, el);
  const btn = el.querySelector('button');
  assert.equal(btn.hasAttribute('disabled'), true);
  disabled.set(false);
  assert.equal(btn.hasAttribute('disabled'), false);
});

test('event handler fires and mutates signal', () => {
  const el = container();
  const count = signal(0);
  mount(html`<button onclick=${() => count.set((c) => c + 1)}>${count}</button>`, el);
  const btn = el.querySelector('button');
  assert.equal(btn.textContent, '0');
  btn.dispatchEvent(new dom.window.Event('click'));
  btn.dispatchEvent(new dom.window.Event('click'));
  assert.equal(btn.textContent, '2');
});

test('property binding (.value)', () => {
  const el = container();
  const text = signal('hello');
  mount(html`<input .value=${text}>`, el);
  const input = el.querySelector('input');
  assert.equal(input.value, 'hello');
  text.set('world');
  assert.equal(input.value, 'world');
});

test('when() conditional toggles', () => {
  const el = container();
  const open = signal(true);
  mount(html`<div>${when(open, () => html`<p>yes</p>`, () => html`<p>no</p>`)}</div>`, el);
  assert.equal(el.querySelector('p').textContent, 'yes');
  open.set(false);
  assert.equal(el.querySelector('p').textContent, 'no');
});

test('each() renders and reconciles a keyed list', () => {
  const el = container();
  const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  mount(html`<ul>${each(items, (i) => html`<li>${i.t}</li>`, (i) => i.id)}</ul>`, el);
  assert.equal(el.querySelectorAll('li').length, 2);
  assert.equal([...el.querySelectorAll('li')].map((l) => l.textContent).join(','), 'a,b');

  // Add an item — existing nodes are reused (same DOM reference for id:1).
  const firstLi = el.querySelector('li');
  items.set((xs) => [...xs, { id: 3, t: 'c' }]);
  assert.equal(el.querySelectorAll('li').length, 3);
  assert.equal(el.querySelector('li'), firstLi, 'kept node for unchanged key');

  // Remove the middle item.
  items.set((xs) => xs.filter((x) => x.id !== 2));
  assert.equal([...el.querySelectorAll('li')].map((l) => l.textContent).join(','), 'a,c');
});

test('nested components compose', () => {
  const el = container();
  const Badge = (props) => html`<span class="badge">${props.label}</span>`;
  const Card = (props) => html`<div class="card">${Badge({ label: props.title })}</div>`;
  mount(Card({ title: 'Weave' }), el);
  assert.equal(el.querySelector('.badge').textContent, 'Weave');
  assert.equal(el.querySelector('.card .badge').textContent, 'Weave');
});

test('multiple holes in one element', () => {
  const el = container();
  const a = signal('A');
  const b = signal('B');
  mount(html`<p data-a=${a} data-b=${b}>${a}-${b}</p>`, el);
  const p = el.querySelector('p');
  assert.equal(p.getAttribute('data-a'), 'A');
  assert.equal(p.getAttribute('data-b'), 'B');
  assert.equal(p.textContent, 'A-B');
  a.set('X');
  assert.equal(p.getAttribute('data-a'), 'X');
  assert.equal(p.textContent, 'X-B');
});
