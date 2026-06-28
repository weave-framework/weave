import { test, assert } from '../../../tools/harness.js';
import { effect, signal } from '@weave/runtime';
import { mount, mountComponent, defineComponent, lazy, type Component } from '@weave/runtime/dom';
import {
  createRouter,
  navigate,
  currentPath,
  currentQuery,
  RouterView,
  Link,
  prefetch,
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

// ── Nested routes (A.3b) ───────────────────────────────────────────────────
const UserList: Component = () => span('user-list');
const UserDetail: Component = (props = {}) => {
  const el = document.createElement('span');
  effect(() => {
    el.textContent = 'detail:' + String((props as { params?: { id?: string } }).params?.id ?? '');
  });
  return el;
};
// A layout with a nested outlet — discovers the router + depth via context (no props).
const UsersLayout = defineComponent(() => {
  const wrap = document.createElement('div');
  wrap.appendChild(span('users-layout'));
  wrap.appendChild(RouterView({}));
  return wrap;
});

function nestedRouter() {
  return createRouter([
    { path: '/', component: Home },
    {
      path: '/users',
      component: UsersLayout,
      children: [
        { path: '', component: UserList },
        { path: ':id', component: UserDetail },
      ],
    },
    { path: '*', component: NotFound },
  ]);
}

test('nested routes resolve to a layout→child chain with accumulated params', () => {
  const r = nestedRouter();
  navigate('/users');
  let ch = r.chain();
  assert.equal(ch.length, 2, 'layout + index child');
  assert.is(ch[0].view, UsersLayout);
  assert.is(ch[1].view, UserList);

  navigate('/users/42');
  ch = r.chain();
  assert.equal(ch.length, 2);
  assert.is(ch[1].view, UserDetail);
  assert.equal(ch[1].params.id, '42', 'leaf carries the accumulated param');
  assert.is(r.matched(0)?.view, UsersLayout, 'matched(0) = layout');
  assert.is(r.matched(1)?.view, UserDetail, 'matched(1) = child');
});

test('nested RouterView renders the child inside the layout', () => {
  const r = nestedRouter();
  navigate('/users/7');
  const el = host();
  mountComponent(RouterView, el, { router: r });
  assert.ok(el.textContent?.includes('users-layout'), 'layout rendered');
  assert.ok(el.textContent?.includes('detail:7'), 'nested child rendered with its param');
});

test('navigating within a layout swaps the nested child but keeps the layout', () => {
  const r = nestedRouter();
  navigate('/users');
  const el = host();
  mountComponent(RouterView, el, { router: r });
  const layoutSpan = el.querySelector('span');
  assert.equal(layoutSpan?.textContent, 'users-layout');
  assert.ok(el.textContent?.includes('user-list'), 'index child shown');

  navigate('/users/3');
  assert.ok(el.textContent?.includes('detail:3'), 'nested child swapped to detail');
  assert.ok(!el.textContent?.includes('user-list'), 'index child removed');
  assert.is(el.querySelector('span'), layoutSpan, 'layout not remounted');
  assert.ok(el.textContent?.includes('users-layout'), 'layout persists across the nested swap');
});

test('leaving the layout subtree clears the nested outlet', () => {
  const r = nestedRouter();
  navigate('/users/9');
  const el = host();
  mountComponent(RouterView, el, { router: r });
  assert.ok(el.textContent?.includes('detail:9'));

  navigate('/');
  assert.ok(el.textContent?.includes('home'), 'top outlet swapped to Home');
  assert.ok(!el.textContent?.includes('users-layout'), 'layout gone');
  assert.ok(!el.textContent?.includes('detail'), 'nested child gone');
});

test('a lazy() component works as a route (code-split page)', async () => {
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  const Page = defineComponent(() => span('lazy-page'));
  const r = createRouter([
    { path: '/lz', component: lazy(() => Promise.resolve({ default: Page })) },
    { path: '*', component: NotFound },
  ]);
  navigate('/lz');
  const el = host();
  mountComponent(RouterView, el, { router: r });
  await settle();
  assert.ok(el.textContent?.includes('lazy-page'), 'lazy route component loaded and rendered');
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

test('Link forwards class / attributes (but not to/prefetch) to the anchor', () => {
  const link = Link(
    { to: '/x', class: 'nav active', id: 'home', 'aria-label': 'Home', prefetch: false },
    {}
  ) as HTMLAnchorElement;
  assert.equal(link.getAttribute('class'), 'nav active', 'class is forwarded');
  assert.equal(link.getAttribute('id'), 'home');
  assert.equal(link.getAttribute('aria-label'), 'Home');
  assert.equal(link.getAttribute('href'), '/x', 'href still from `to`');
  assert.equal(link.getAttribute('prefetch'), null, '`prefetch` is not leaked as an attribute');
  assert.equal(link.getAttribute('to'), null, '`to` is not leaked as an attribute');
});

/* ──────────── prefetch (B.15) ──────────── */

const LazyPage = defineComponent(() => span('lazy'));

test('lazy().preload triggers the loader once, without rendering', () => {
  let loads = 0;
  const L = lazy(() => {
    loads++;
    return Promise.resolve({ default: LazyPage });
  }) as Component & { preload: () => void };
  assert.equal(loads, 0);
  L.preload();
  assert.equal(loads, 1, 'preload ran the loader');
  L.preload();
  assert.equal(loads, 1, 'idempotent — loads once');
});

test('router.preload warms a lazy route chunk ahead of navigation', () => {
  let loads = 0;
  const r = createRouter([
    { path: '/heavy', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  assert.equal(loads, 0);
  r.preload('/heavy');
  assert.equal(loads, 1, 'lazy chunk loaded by preload');
});

test('Link prefetches the target chunk on hover (once)', () => {
  navigate('/');
  let loads = 0;
  createRouter([
    { path: '/hv', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  const link = Link({ to: '/hv' }, {}) as HTMLAnchorElement;
  host().appendChild(link);
  assert.equal(loads, 0, 'not loaded before hover');
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1, 'hover warmed the chunk');
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1, 'warmed only once');
});

test('Link prefetch={false} does not warm on hover', () => {
  let loads = 0;
  createRouter([
    { path: '/np', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  const link = Link({ to: '/np', prefetch: false }, {}) as HTMLAnchorElement;
  host().appendChild(link);
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 0, 'prefetch disabled — no load on hover');
});
