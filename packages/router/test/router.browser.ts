import { test, assert } from '../../../tools/harness.js';
import { effect, signal, tick, fade } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';
import { mount, mountComponent, defineComponent, lazy, type Component } from '@weave-framework/runtime/dom';
import {
  createRouter,
  navigate,
  currentPath,
  currentQuery,
  afterEach,
  RouterView,
  Link,
  prefetch,
  useRouter,
  route,
  useLoaderData,
} from '@weave-framework/router';
import type { Router, Match, LoaderData } from '@weave-framework/router';

/** Flush a macrotask + pending effects so an async loader settles. */
const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
};

// Route "components" are plain Component functions returning a <span> (so they
// are distinguishable from RouterView's own display:contents <div> host).
const Home: Component = () => span('home');
const About: Component = () => span('about');
const NotFound: Component = () => span('404');
const Login: Component = () => span('login');
const User: Component = (props = {}) => {
  const el: HTMLSpanElement = document.createElement('span');
  effect(() => {
    el.textContent = 'user:' + String((props as { params?: { id?: string } }).params?.id ?? '');
  });
  return el;
};

function span(text: string): HTMLSpanElement {
  const el: HTMLSpanElement = document.createElement('span');
  el.textContent = text;
  return el;
}
function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('createRouter matches static, param, and fallback routes', () => {
  const r: Router = createRouter([
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
  const r: Router = createRouter([{ path: '/search', component: Home }]);
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
  const r: Router = createRouter([
    { path: '/ok', component: Home, guard: () => true },
    { path: '*', component: NotFound },
  ]);
  navigate('/ok');
  assert.is(r.matched()?.view, Home);
});

test('a guard returning false blocks the route (falls back)', () => {
  const r: Router = createRouter([
    { path: '/secret', component: Home, guard: () => false },
    { path: '*', component: NotFound },
  ]);
  navigate('/secret');
  assert.is(r.matched()?.view, NotFound, 'blocked → fallback');
});

test('a guard returning a path redirects (and signals the canonical URL)', () => {
  const r: Router = createRouter([
    { path: '/admin', component: Home, guard: () => '/login' },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/admin');
  assert.is(r.matched()?.view, Login, 'resolved to the redirect target component');
  assert.equal(r.redirectTo(), '/login', 'canonical URL surfaced for the outlet to sync');
});

test('a static redirect resolves to the target component', () => {
  const r: Router = createRouter([
    { path: '/old', redirect: '/new' },
    { path: '/new', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/old');
  assert.is(r.matched()?.view, About);
  assert.equal(r.redirectTo(), '/new');
});

test('a guard re-resolves when the auth signal it reads changes', () => {
  const authed: Signal<boolean> = signal(false);
  const r: Router = createRouter([
    { path: '/dash', component: Home, guard: () => (authed() ? true : '/login') },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/dash');
  assert.is(r.matched()?.view, Login, 'unauthed → redirected to login');
  authed.set(true);
  assert.is(r.matched()?.view, Home, 'authed → route re-resolves to the real component');
});

test('route() builds routes that match like the object form (incl. params)', () => {
  const r: Router = createRouter([
    route('/user/:id', { component: User }),
    route('/about', { component: About }),
    { path: '*', component: NotFound },
  ]);
  navigate('/user/7');
  assert.is(r.matched()?.view, User, 'route() component matched');
  assert.equal(r.matched()?.params.id, '7', 'param captured via route() builder');
  navigate('/about');
  assert.is(r.matched()?.view, About);
  navigate('/nope');
  assert.is(r.matched()?.view, NotFound, 'plain-object fallback still works alongside route()');
});

test('route() guard receives the path params (typed at compile time, correct at runtime)', () => {
  let seenId: string | null = null;
  const r: Router = createRouter([
    route('/user/:id', {
      component: User,
      // `ctx.params.id` is typed `string` (inferred from '/user/:id') — see the tsc check.
      guard: (ctx) => {
        seenId = ctx.params.id;
        return true;
      },
    }),
    { path: '*', component: NotFound },
  ]);
  navigate('/user/9');
  assert.is(r.matched()?.view, User);
  assert.equal(seenId, '9', 'guard saw the param value');
});

test('a route loader is exposed via useLoaderData(): loading → data, re-runs on param change', async () => {
  let ld: LoaderData<string> | null = null;
  const UserL: Component = () => {
    ld = useLoaderData<string>();
    const el: HTMLSpanElement = document.createElement('span');
    effect(() => {
      el.textContent = ld!.loading() ? 'pending' : String(ld!.data());
    });
    return el;
  };
  const r: Router = createRouter([
    route('/u/:id', { component: UserL, loader: ({ params }) => Promise.resolve('LOADED:' + params.id) }),
    { path: '*', component: NotFound },
  ]);
  navigate('/u/1');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  assert.equal(el.textContent, 'pending', 'loading before the loader settles');
  await flush();
  assert.equal(el.textContent, 'LOADED:1', 'loader value rendered after settle');
  navigate('/u/2');
  await flush();
  assert.equal(el.textContent, 'LOADED:2', 'loader re-ran on a param change');
});

test('useLoaderData() throws when the route has no loader', () => {
  let threw: boolean = false;
  const NoLoader: Component = () => {
    try {
      useLoaderData();
    } catch {
      threw = true;
    }
    return span('x');
  };
  const r: Router = createRouter([{ path: '/', component: NoLoader }, { path: '*', component: NotFound }]);
  navigate('/');
  mountComponent(RouterView, host(), { router: r });
  assert.ok(threw, 'throws without a loader in context');
});

test('useRouter() injects the router in a routed component; r.navigate/path/query work', () => {
  let seen: Router | null = null;
  const Probe: Component = () => {
    seen = useRouter();
    return span('probe');
  };
  const r: Router = createRouter([
    { path: '/', component: Probe },
    { path: '/about', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  assert.is(seen, r, 'useRouter() returns the router from context');
  // The instance methods drive THIS router's own signals (no module singleton).
  seen!.navigate('/about?tab=x');
  assert.equal(seen!.path(), '/about', 'r.path() reflects r.navigate()');
  assert.equal(seen!.query().tab, 'x', 'r.query() parses the query');
  assert.ok(el.textContent?.includes('about'), 'the outlet swapped via r.navigate()');
});

test('useRouter() throws outside a <RouterView> subtree', () => {
  let threw: boolean = false;
  try {
    useRouter();
  } catch {
    threw = true;
  }
  assert.ok(threw, 'throws when no router is in context');
});

test('RouterView swaps components on navigation', () => {
  const r: Router = createRouter([
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/');
  const el: HTMLElement = host();
  mount(RouterView({ router: r }), el);
  assert.ok(el.textContent?.includes('home'), 'initial route rendered');

  navigate('/about');
  assert.ok(el.textContent?.includes('about'), 'swapped to new route');
  assert.ok(!el.textContent?.includes('home'), 'old route removed');
});

test('RouterView with a transition wraps the view (so the intro can play) and still swaps', () => {
  const r: Router = createRouter([
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '*', component: NotFound },
  ]);
  navigate('/');
  const el: HTMLElement = host();
  mount(RouterView({ router: r, transition: fade }), el);
  const span: HTMLSpanElement | null = el.querySelector('span');
  assert.equal(el.textContent, 'home', 'initial route rendered');
  assert.ok(span && span.parentElement !== el && span.parentElement!.tagName === 'DIV', 'view wrapped in a transition host <div>');
  navigate('/about');
  assert.equal(el.textContent, 'about', 'swaps the routed view under a transition');
});

test('RouterView keeps the instance on a param-only change', () => {
  const r: Router = createRouter([
    { path: '/user/:id', component: User },
    { path: '*', component: NotFound },
  ]);
  navigate('/user/1');
  const el: HTMLElement = host();
  mount(RouterView({ router: r }), el);
  const node: HTMLSpanElement | null = el.querySelector('span');
  assert.equal(node?.textContent, 'user:1');

  navigate('/user/2');
  assert.equal(el.querySelector('span')?.textContent, 'user:2', 'params updated in place');
  assert.is(el.querySelector('span'), node, 'same node — no remount');
});

test('RouterView syncs the address bar on a guard redirect', () => {
  const r: Router = createRouter([
    { path: '/private', component: Home, guard: () => '/login' },
    { path: '/login', component: Login },
    { path: '*', component: NotFound },
  ]);
  navigate('/private');
  const el: HTMLElement = host();
  mount(RouterView({ router: r }), el);
  assert.ok(el.textContent?.includes('login'), 'redirect target rendered');
  assert.equal(currentPath(), '/login', 'address bar synced to the redirect target');
});

// ── Nested routes (A.3b) ───────────────────────────────────────────────────
const UserList: Component = () => span('user-list');
const UserDetail: Component = (props = {}) => {
  const el: HTMLSpanElement = document.createElement('span');
  effect(() => {
    el.textContent = 'detail:' + String((props as { params?: { id?: string } }).params?.id ?? '');
  });
  return el;
};
// A layout with a nested outlet — discovers the router + depth via context (no props).
const UsersLayout: Component = defineComponent(() => {
  const wrap: HTMLDivElement = document.createElement('div');
  wrap.appendChild(span('users-layout'));
  wrap.appendChild(RouterView({}));
  return wrap;
});

function nestedRouter(): Router {
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
  const r: Router = nestedRouter();
  navigate('/users');
  let ch: Match[] = r.chain();
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
  const r: Router = nestedRouter();
  navigate('/users/7');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  assert.ok(el.textContent?.includes('users-layout'), 'layout rendered');
  assert.ok(el.textContent?.includes('detail:7'), 'nested child rendered with its param');
});

test('navigating within a layout swaps the nested child but keeps the layout', () => {
  const r: Router = nestedRouter();
  navigate('/users');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  const layoutSpan: HTMLSpanElement | null = el.querySelector('span');
  assert.equal(layoutSpan?.textContent, 'users-layout');
  assert.ok(el.textContent?.includes('user-list'), 'index child shown');

  navigate('/users/3');
  assert.ok(el.textContent?.includes('detail:3'), 'nested child swapped to detail');
  assert.ok(!el.textContent?.includes('user-list'), 'index child removed');
  assert.is(el.querySelector('span'), layoutSpan, 'layout not remounted');
  assert.ok(el.textContent?.includes('users-layout'), 'layout persists across the nested swap');
});

test('leaving the layout subtree clears the nested outlet', () => {
  const r: Router = nestedRouter();
  navigate('/users/9');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  assert.ok(el.textContent?.includes('detail:9'));

  navigate('/');
  assert.ok(el.textContent?.includes('home'), 'top outlet swapped to Home');
  assert.ok(!el.textContent?.includes('users-layout'), 'layout gone');
  assert.ok(!el.textContent?.includes('detail'), 'nested child gone');
});

test('a lazy() component works as a route (code-split page)', async () => {
  const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
  const Page: Component = defineComponent(() => span('lazy-page'));
  const r: Router = createRouter([
    { path: '/lz', component: lazy(() => Promise.resolve({ default: Page })) },
    { path: '*', component: NotFound },
  ]);
  navigate('/lz');
  const el: HTMLElement = host();
  mountComponent(RouterView, el, { router: r });
  await settle();
  assert.ok(el.textContent?.includes('lazy-page'), 'lazy route component loaded and rendered');
});

test('Link navigates on a plain click', () => {
  navigate('/');
  const el: HTMLElement = host();
  const link: Node = Link({ to: '/about' }, { default: () => document.createTextNode('About') });
  el.appendChild(link);
  assert.equal((link as HTMLAnchorElement).getAttribute('href'), '/about');
  (link as HTMLAnchorElement).click();
  assert.equal(currentPath(), '/about', 'client-side navigation fired');
});

test('Link forwards class / attributes (but not to/prefetch) to the anchor', () => {
  const link: HTMLAnchorElement = Link(
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

test('Link sets aria-current + activeClass when active, clears when not', () => {
  navigate('/about');
  const a: HTMLAnchorElement = Link({ to: '/about', activeClass: 'is-active' }, {}) as HTMLAnchorElement;
  assert.equal(a.getAttribute('aria-current'), 'page', 'aria-current set when active');
  assert.ok(a.classList.contains('is-active'), 'activeClass added when active');
  navigate('/elsewhere');
  assert.equal(a.getAttribute('aria-current'), null, 'aria-current cleared on navigation away');
  assert.ok(!a.classList.contains('is-active'), 'activeClass removed on navigation away');
});

test('Link active is prefix-matched for nested paths; exact opts out', () => {
  navigate('/users/42');
  const parent: HTMLAnchorElement = Link({ to: '/users', activeClass: 'on' }, {}) as HTMLAnchorElement;
  assert.ok(parent.classList.contains('on'), 'parent link active on a child path (prefix)');
  const strict: HTMLAnchorElement = Link({ to: '/users', activeClass: 'on', exact: true }, {}) as HTMLAnchorElement;
  assert.ok(!strict.classList.contains('on'), 'exact link not active on a child path');
});

test('Link to "/" is active only at exactly "/"', () => {
  navigate('/something');
  const home: HTMLAnchorElement = Link({ to: '/', activeClass: 'on' }, {}) as HTMLAnchorElement;
  assert.ok(!home.classList.contains('on'), 'root link not active on a sub-path');
  navigate('/');
  assert.ok(home.classList.contains('on'), 'root link active at root');
});

/* ──────────── navigation hooks + scroll (R.3) ──────────── */

test('afterEach fires on each navigation with the new path; unsubscribe stops it', () => {
  const seen: string[] = [];
  const off: () => void = afterEach((n) => seen.push(`${n.type}:${n.path}`));
  navigate('/hook-a');
  navigate('/hook-b');
  off();
  navigate('/hook-c');
  assert.deepEqual(seen, ['push:/hook-a', 'push:/hook-b'], 'fired for each push, stopped after unsubscribe');
});

test('navigation scrolls to top on a push', async () => {
  const ys: number[] = [];
  const orig: typeof window.scrollTo = window.scrollTo;
  (window as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo = (_x, y) => ys.push(y);
  try {
    navigate('/scroll-top');
    await tick();
    assert.ok(ys.includes(0), `scrolled to top after push (got ${ys})`);
  } finally {
    window.scrollTo = orig;
  }
});

test('a #fragment in the target scrolls to that element instead of the top', async () => {
  const sec: HTMLDivElement = document.createElement('div');
  sec.id = 'frag-target';
  document.body.appendChild(sec);
  let intoView: boolean = false;
  sec.scrollIntoView = (): void => { intoView = true; };
  const orig: typeof window.scrollTo = window.scrollTo;
  let topped: boolean = false;
  (window as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo = () => { topped = true; };
  try {
    navigate('/with-frag#frag-target');
    await tick();
    assert.ok(intoView, 'scrollIntoView called on the #fragment element');
    assert.ok(!topped, 'did not also scroll to top');
  } finally {
    window.scrollTo = orig;
    sec.remove();
  }
});

test('navigation saves the current scroll, and a pop restores it', async () => {
  const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(window, 'scrollY');
  let fakeY: number = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => fakeY });
  const ys: number[] = [];
  const orig: typeof window.scrollTo = window.scrollTo;
  (window as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo = (_x, y) => ys.push(y);
  try {
    fakeY = 320; // the user has scrolled down the current page
    navigate('/leave-here'); // saves 320 for the position being left
    ys.length = 0;
    // Going back to that position (a pop) should restore its saved scroll, not top.
    window.dispatchEvent(new PopStateEvent('popstate', { state: { __wpos: 0 } }));
    await tick();
    assert.ok(ys.includes(320), `restored the saved scroll on pop (got ${ys})`);
  } finally {
    window.scrollTo = orig;
    if (desc) Object.defineProperty(window, 'scrollY', desc);
  }
});

/* ──────────── prefetch (B.15) ──────────── */

const LazyPage: Component = defineComponent(() => span('lazy'));

test('lazy().preload triggers the loader once, without rendering', () => {
  let loads: number = 0;
  const L: Component & { preload: () => void } = lazy(() => {
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
  let loads: number = 0;
  const r: Router = createRouter([
    { path: '/heavy', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  assert.equal(loads, 0);
  r.preload('/heavy');
  assert.equal(loads, 1, 'lazy chunk loaded by preload');
});

test('Link prefetches the target chunk on hover (once)', () => {
  navigate('/');
  let loads: number = 0;
  createRouter([
    { path: '/hv', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  const link: HTMLAnchorElement = Link({ to: '/hv' }, {}) as HTMLAnchorElement;
  host().appendChild(link);
  assert.equal(loads, 0, 'not loaded before hover');
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1, 'hover warmed the chunk');
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 1, 'warmed only once');
});

test('Link prefetch={{false}} does not warm on hover', () => {
  let loads: number = 0;
  createRouter([
    { path: '/np', component: lazy(() => { loads++; return Promise.resolve({ default: LazyPage }); }) },
    { path: '*', component: NotFound },
  ]);
  const link: HTMLAnchorElement = Link({ to: '/np', prefetch: false }, {}) as HTMLAnchorElement;
  host().appendChild(link);
  link.dispatchEvent(new Event('pointerenter'));
  assert.equal(loads, 0, 'prefetch disabled — no load on hover');
});
