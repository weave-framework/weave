import { test, assert } from '../../../tools/harness.js';
import { effect, signal } from '@weave/runtime';
import { mount, type Component } from '@weave/runtime/dom';
import {
  createRouter,
  navigate,
  currentPath,
  currentQuery,
  RouterView,
  Link,
} from '@weave/router';

// Route "components" are plain Component functions returning a <span> (so they
// are distinguishable from RouterView's own display:contents <div> host).
const Home: Component = () => span('home');
const About: Component = () => span('about');
const NotFound: Component = () => span('404');
const Login: Component = () => span('login');
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
  const r = createRouter([
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/user/:id', component: User },
    { path: '*', component: NotFound },
  ]);
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

test('query string is parsed reactively (pathname stays clean)', () => {
  const r = createRouter([{ path: '/search', component: Home }]);
  navigate('/search?q=hello&page=2');
  assert.equal(currentPath(), '/search', 'pathname excludes the query');
  assert.equal(currentQuery().q, 'hello');
  assert.equal(currentQuery().page, '2');
  assert.equal(r.query().q, 'hello', 'router exposes the same query');
  assert.is(r.matched()?.view, Home);
  navigate('/search');
  assert.equal(currentQuery().q, undefined, 'query cleared when absent');
});

test('a guard returning true allows the route', () => {
  const r = createRouter([
    { path: '/ok', component: Home, guard: () => true },
    { path: '*', component: NotFound },
  ]);
  navigate('/ok');
  assert.is(r.matched()?.view, Home);
});

test('a guard returning false blocks the route (falls back)', () => {
  const r = createRouter([
    { path: '/secret', component: Home, guard: () => false },
    { path: '*', component: NotFound },
  ]);
  navigate('/secret');
  assert.is(r.matched()?.view, NotFound, 'blocked → fallback');
});

test('a guard returning a path redirects (and signals the canonical URL)', () => {
  const r = createRouter([
    { path: '/admin', component: Home, guard: () => '/login' },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/admin');
  assert.is(r.matched()?.view, Login, 'resolved to the redirect target component');
  assert.equal(r.redirectTo(), '/login', 'canonical URL surfaced for the outlet to sync');
});

test('a static redirect resolves to the target component', () => {
  const r = createRouter([
    { path: '/old', redirect: '/new' },
    { path: '/new', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/old');
  assert.is(r.matched()?.view, About);
  assert.equal(r.redirectTo(), '/new');
});

test('a guard re-resolves when the auth signal it reads changes', () => {
  const authed = signal(false);
  const r = createRouter([
    { path: '/dash', component: Home, guard: () => (authed() ? true : '/login') },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/dash');
  assert.is(r.matched()?.view, Login, 'unauthed → redirected to login');
  authed.set(true);
  assert.is(r.matched()?.view, Home, 'authed → route re-resolves to the real component');
});

test('RouterView swaps components on navigation', () => {
  const r = createRouter([
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/');
  const el = host();
  mount(RouterView({ router: r }), el);
  assert.ok(el.textContent?.includes('home'), 'initial route rendered');

  navigate('/about');
  assert.ok(el.textContent?.includes('about'), 'swapped to new route');
  assert.ok(!el.textContent?.includes('home'), 'old route removed');
});

test('RouterView keeps the instance on a param-only change', () => {
  const r = createRouter([
    { path: '/user/:id', component: User },
    { path: '*', component: NotFound },
  ]);
  navigate('/user/1');
  const el = host();
  mount(RouterView({ router: r }), el);
  const node = el.querySelector('span');
  assert.equal(node?.textContent, 'user:1');

  navigate('/user/2');
  assert.equal(el.querySelector('span')?.textContent, 'user:2', 'params updated in place');
  assert.is(el.querySelector('span'), node, 'same node — no remount');
});

test('RouterView syncs the address bar on a guard redirect', () => {
  const r = createRouter([
    { path: '/private', component: Home, guard: () => '/login' },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/private');
  const el = host();
  mount(RouterView({ router: r }), el);
  assert.ok(el.textContent?.includes('login'), 'redirect target rendered');
  assert.equal(currentPath(), '/login', 'address bar synced to the redirect target');
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
