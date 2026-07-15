/**
 * Node smoke for headless router SSR (Phase E, E1.3c) — the router resolves an injected route with NO
 * browser (`window`/`location`/`history` all absent under the server DOM).
 *
 * Installs the headless DOM (importing runtime/server), then drives the router purely through
 * `setServerLocation(url)` + `createRouter` and renders `<RouterView>` to an HTML string, asserting the
 * matched route's component was rendered — and that params/query come from the injected URL, not `location`.
 *
 * Run: `node packages/router/test/ssr.smoke.mjs` (wired as `pnpm verify:router-ssr`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// runtime/server is imported FIRST so its top-level installServerDom() runs before the router module
// evaluates — the router's import-time code reads `typeof window/history` and must see them absent.
const entry = `
  import { renderComponent } from '@weave-framework/runtime/server';
  import { createRouter, setServerLocation, route, RouterView } from '@weave-framework/router';
  import * as dom from '@weave-framework/runtime/dom';
  import { signal } from '@weave-framework/runtime';
  import { compileTemplate } from '@weave-framework/compiler';
  export const rt = { ...dom, signal };
  export { renderComponent, createRouter, setServerLocation, route, RouterView, compileTemplate };
`;
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'router-ssr-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'router-ssr-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: out,
});
const { rt, renderComponent, createRouter, setServerLocation, route, RouterView, compileTemplate } = await import(
  pathToFileURL(out).href
);

console.log('verify:router-ssr — headless per-route rendering\n');

// The server has no location: proves the guards hold and the module loaded without a browser.
ok(typeof location === 'undefined' && typeof window === 'undefined' && typeof history === 'undefined',
  'no browser globals (window/location/history) present');

/** Compile a tiny template to a component with the given setup. */
const make = (markup, scope, setup) => {
  const { code } = compileTemplate(markup, { mode: 'function', scope });
  const fn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  return rt.defineComponent(fn, setup ?? (() => ({})));
};

const Home = make('<h1>Home page</h1>', []);
const About = make('<h1>About page</h1>', []);
const User = make('<h1>User {{ id }}</h1>', ['id'], (props) => ({ id: props.params.id }));

const routes = [
  route('/', { component: Home }),
  route('/about', { component: About }),
  route('/user/:id', { component: User }),
];

// Render one route headlessly: seed the location, build the router, render the outlet to a string.
const renderRoute = (url) => {
  setServerLocation(url);
  const router = createRouter(routes);
  return { html: renderComponent(RouterView, { router }), router };
};

// Root route.
{
  const { html, router } = renderRoute('/');
  ok(/Home page/.test(html), "'/' renders the Home component");
  ok(router.path() === '/', "'/' → router.path() is '/'");
}

// A different route — proves the injected path, not a default, drives resolution.
{
  const { html, router } = renderRoute('/about');
  ok(/About page/.test(html), "'/about' renders the About component (injected path drove resolution)");
  ok(router.path() === '/about', "'/about' → router.path() is '/about'");
  ok(!/Home page/.test(html), "'/about' does NOT render Home");
}

// Path params come from the injected URL.
{
  const { html } = renderRoute('/user/42');
  ok(/User 42/.test(html), "'/user/42' renders User with param id=42 from the injected path");
}

// Query is parsed from the injected URL's search string.
{
  const { router } = renderRoute('/about?tab=security&x=1');
  ok(router.query().tab === 'security' && router.query().x === '1', 'query parsed from the injected search string');
}

// Unknown route with no fallback → empty chain, no crash.
{
  const { html, router } = renderRoute('/missing');
  ok(router.chain().length === 0, "unknown route with no '*' fallback → empty chain (no crash)");
  ok(!/page/.test(html), 'unknown route renders no page component');
}

console.log('');
if (failures) {
  console.error(`✖ ${failures} router-ssr check(s) failed.`);
  process.exit(1);
}
console.log('✓ headless router resolves injected routes without a browser.');
