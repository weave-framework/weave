import { test, assert } from '../../../tools/harness.js';
import { effect } from '@weave/runtime';
import { mount, type Component } from '@weave/runtime/dom';
import { createRouter, navigate, currentPath, RouterView, Link } from '@weave/router';

// Route "components" are plain Component functions returning a <span> (so they
// are distinguishable from RouterView's own display:contents <div> host).
const Home: Component = () => span('home');
const About: Component = () => span('about');
const NotFound: Component = () => span('404');
const User: Component = (props = {}) => {
  const el = document.createElement('span');
  effect(() => {
    el.textContent = 'user:' + String((props as { params?: { id?: string } }).params?.id ?? '');
  });
  return el;
};

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

test('createRouter matches static, param, and fallback routes', () => {
  const r = createRouter({ '/': Home, '/about': About, '/user/:id': User, '*': NotFound });
  navigate('/');
  assert.is(r.matched()?.view, Home);
  navigate('/about');
  assert.is(r.matched()?.view, About);
  navigate('/user/42');
  assert.is(r.matched()?.view, User);
  assert.equal(r.matched()?.params.id, '42', 'path param captured');
  navigate('/does-not-exist');
  assert.is(r.matched()?.view, NotFound, 'falls back to *');
});

test('navigate updates currentPath', () => {
  navigate('/about');
  assert.equal(currentPath(), '/about');
});

test('RouterView swaps components on navigation', () => {
  const r = createRouter({ '/': Home, '/about': About, '*': NotFound });
  navigate('/');
  const el = host();
  mount(RouterView({ router: r }), el);
  assert.ok(el.textContent?.includes('home'), 'initial route rendered');

  navigate('/about');
  assert.ok(el.textContent?.includes('about'), 'swapped to new route');
  assert.ok(!el.textContent?.includes('home'), 'old route removed');
});

test('RouterView keeps the instance on a param-only change', () => {
  const r = createRouter({ '/user/:id': User, '*': NotFound });
  navigate('/user/1');
  const el = host();
  mount(RouterView({ router: r }), el);
  const node = el.querySelector('span');
  assert.equal(node?.textContent, 'user:1');

  navigate('/user/2');
  assert.equal(el.querySelector('span')?.textContent, 'user:2', 'params updated in place');
  assert.is(el.querySelector('span'), node, 'same node — no remount');
});

test('Link navigates on a plain click', () => {
  navigate('/');
  const el = host();
  const link = Link({ to: '/about' }, { default: () => document.createTextNode('About') });
  el.appendChild(link);
  assert.equal((link as HTMLAnchorElement).getAttribute('href'), '/about');
  (link as HTMLAnchorElement).click();
  assert.equal(currentPath(), '/about', 'client-side navigation fired');
});
