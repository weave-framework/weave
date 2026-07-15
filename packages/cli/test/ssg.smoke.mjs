/**
 * Node smoke for the SSG build plumbing (Phase E, E1.3b) — root-render prerender + CSR client.
 *
 * Part 1 (this commit) pins the entry generators: `generateServerEntry` emits a Node module that renders the
 * root headlessly, and `generateEntry` still emits the client CSR mount. Part 2 (E1.3b-2) extends this with a
 * real end-to-end `weave build --ssg` into a temp dir.
 *
 * Run: `node packages/cli/test/ssg.smoke.mjs` (wired as `pnpm verify:ssg`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// Bundle the CLI generators + buildSsg on the fly (runtime bundled in, so the temp server entry Node-imports
// compile cleanly; buildSsg itself dynamic-imports the temp server bundle it emits).
const entry = `
  export { generateServerEntry, generateEntry, discoverCustomElements } from './packages/cli/src/entry.ts';
  export { buildSsg } from './packages/cli/src/build.ts';
  export { staticRoutePaths } from './packages/cli/src/routes.ts';
`;
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'ssg-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'ssg-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  // Bundle the @weave-framework/* workspace sources (their `.ts` can't be Node-imported directly), but keep
  // `esbuild` external — buildSsg calls it internally, and it resolves from node_modules at runtime.
  external: ['esbuild'],
  outfile: out,
});
const { generateServerEntry, generateEntry, discoverCustomElements, buildSsg, staticRoutePaths } = await import(pathToFileURL(out).href);

console.log('verify:ssg — SSG build plumbing\n');

/* ── Part 1 — the entry generators (pure strings) ── */

// The server entry: installs the headless DOM (runtime/server) BEFORE the root, then renders it, exports render().
const rootDir = join(repo, 'app');
const server = generateServerEntry(join(rootDir, 'App.ts'), rootDir);
ok(server.includes(`import Root from "./App";`), 'server entry: imports the root (./App)');
ok(server.includes(`from "@weave-framework/runtime/server"`), 'server entry: imports renderPage from runtime/server');
ok(server.indexOf('runtime/server') < server.indexOf('import Root'), 'server entry: installs the DOM (runtime/server) BEFORE the root module');
ok(/export function render\(\)\s*\{\s*return renderPage\(Root, \{\}\);\s*\}/.test(server), 'server entry: exports render() → renderPage(Root, {})');

// A root component nested a folder deep still resolves relative to rootDir.
const nested = generateServerEntry(join(rootDir, 'pages', 'Home.ts'), rootDir);
ok(nested.includes(`import Root from "./pages/Home";`), 'server entry: nested root path is relative to rootDir');

// Routed variant (E1.3c): imports the SSR seam and seeds the location per route.
const routedServer = generateServerEntry(join(rootDir, 'App.ts'), rootDir, { routed: true });
ok(routedServer.includes('import { setServerLocation } from "@weave-framework/router"'), 'routed server entry: imports setServerLocation');
ok(/export function render\(route\)\s*\{\s*setServerLocation\(route \?\? "\/"\);/.test(routedServer), 'routed server entry: render(route) seeds the location before rendering');
ok(!server.includes('setServerLocation'), 'non-routed server entry does NOT import the router (no dep)');

// The client entry is unchanged CSR mount (resumePage is E1.3c) — the server HTML is a first-paint shell.
const client = generateEntry(join(rootDir, 'App.ts'), '#app', rootDir, []);
ok(client.includes('mountComponent(Root, "#app")'), 'client entry: still a CSR mountComponent at the mount selector');

/* ── Part 2 — end-to-end `buildSsg` into a temp dir with a real component ── */

// Fixture app + output live under the repo (so the internal esbuild resolves @weave-framework/* by walking up
// to repo/node_modules) but NOT under node_modules (the weave loader skips node_modules, so a fixture there
// would never be compiled). `.smoke-*/` is gitignored.
const app = mkdtempSync(join(here, '.smoke-ssg-app-'));
const outDir = mkdtempSync(join(here, '.smoke-ssg-out-'));
try {
  // A real Weave component: setup() + sibling .html (the loader compiles the pair).
  writeFileSync(
    join(app, 'App.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';\n` +
      `export function setup(): { count: Signal<number>; inc: () => void } {\n` +
      `  const count = signal(0);\n` +
      `  const inc = () => count.set((n) => n + 1);\n` +
      `  return { count, inc };\n}\n`
  );
  writeFileSync(
    join(app, 'App.html'),
    `<main class="app"><h1>Weave SSG</h1><button on:click={{ inc }}>clicked {{ count() }} times</button></main>`
  );

  const rootComponent = join(app, 'App.ts');
  await buildSsg({
    virtualEntry: { code: generateEntry(rootComponent, '#app', app, discoverCustomElements(app)), resolveDir: app },
    serverEntry: { code: generateServerEntry(rootComponent, app), resolveDir: app },
    mount: '#app',
    outDir,
    minify: false,
    styleLang: 'css',
    title: 'Weave SSG',
    lang: 'en',
  });

  const index = join(outDir, 'index.html');
  ok(existsSync(index), 'index.html was written');
  ok(existsSync(join(outDir, 'main.js')), 'client bundle main.js was written');

  const doc = existsSync(index) ? readFileSync(index, 'utf8') : '';
  ok(doc.startsWith('<!DOCTYPE html>'), 'index.html is a complete document');
  ok(doc.includes('<title>Weave SSG</title>') && doc.includes('<html lang="en">'), 'document carries title + lang');
  // The server render (NOT the client CSR) produced real HTML at build time — headless DOM worked.
  ok(/<h1[^>]*>Weave SSG<\/h1>/.test(doc), 'server-rendered HTML is present (headless render ran)');
  // count() → 0 evaluated at render time; the `<!---->` is the binding's text anchor.
  ok(/clicked 0<!---->\s*times/.test(doc), 'server render evaluated the template bindings (count() → 0)');
  // The server HTML sits inside the #app mount target so the client CSR mounts over it.
  ok(/<div id="app"><main[^>]*class="app"/.test(doc), 'server HTML wraps inside the #app mount target');
  ok(doc.includes('<script type="module" src="/main.js">'), 'client entry script is linked');
  ok(doc.includes('<link rel="stylesheet" href="/app.css">'), 'app.css is linked');
  // The data-w-* scope attribute proves the loader style-scoped the component (not raw markup).
  ok(/<main data-w-[a-z0-9]+ class="app"/.test(doc), 'component compiled + style-scoped through the weave loader');
} finally {
  rmSync(app, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}

/* ── Part 3 — routed SSG: a root that renders <RouterView>, prerendered to one file per route ── */

const rapp = mkdtempSync(join(here, '.smoke-ssg-rapp-'));
const rout = mkdtempSync(join(here, '.smoke-ssg-rout-'));
try {
  // Leaf pages (inline templates) + a root whose template is the router outlet.
  writeFileSync(join(rapp, 'home.ts'), `export const template = '<h1>Home page</h1>';\n`);
  writeFileSync(join(rapp, 'about.ts'), `export const template = '<h1>About page</h1>';\n`);
  writeFileSync(
    join(rapp, 'app.ts'),
    `import { createRouter, route, RouterView } from '@weave-framework/router';\n` +
      `import Home from './home';\n` +
      `import About from './about';\n` +
      `export const template = '<RouterView router={{ router }} />';\n` +
      `export function setup() {\n` +
      `  const router = createRouter([ route('/', { component: Home }), route('/about', { component: About }) ]);\n` +
      `  return { router };\n}\n`
  );

  const rootComponent = join(rapp, 'app.ts');
  await buildSsg({
    virtualEntry: { code: generateEntry(rootComponent, '#app', rapp, discoverCustomElements(rapp)), resolveDir: rapp },
    serverEntry: { code: generateServerEntry(rootComponent, rapp, { routed: true }), resolveDir: rapp },
    mount: '#app',
    routes: ['/', '/about'],
    outDir: rout,
    minify: false,
    styleLang: 'css',
    title: 'Routed SSG',
    lang: 'en',
  });

  const homeFile = join(rout, 'index.html');
  const aboutFile = join(rout, 'about', 'index.html');
  ok(existsSync(homeFile), "root route → index.html");
  ok(existsSync(aboutFile), "'/about' → about/index.html");

  const homeDoc = existsSync(homeFile) ? readFileSync(homeFile, 'utf8') : '';
  const aboutDoc = existsSync(aboutFile) ? readFileSync(aboutFile, 'utf8') : '';
  // Each file carries ONLY its route's component — proof the injected path drove per-route resolution headlessly.
  ok(/<h1[^>]*>Home page<\/h1>/.test(homeDoc) && !/About page/.test(homeDoc), 'index.html has Home (not About)');
  ok(/<h1[^>]*>About page<\/h1>/.test(aboutDoc) && !/Home page/.test(aboutDoc), 'about/index.html has About (not Home)');
  ok(/<div id="app">/.test(homeDoc) && homeDoc.includes('<script type="module" src="/main.js">'), 'routed docs carry the #app shell + client entry');
} finally {
  rmSync(rapp, { recursive: true, force: true });
  rmSync(rout, { recursive: true, force: true });
}

/* ── Part 4 — staticRoutePaths derives the prerender list from a pages dir (skips :param + *) ── */

const pages = mkdtempSync(join(here, '.smoke-ssg-pages-'));
try {
  mkdirSync(join(pages, 'learn'));
  mkdirSync(join(pages, 'user'));
  const page = (p) => writeFileSync(p, 'export const template = "<i>x</i>";\n');
  page(join(pages, 'index.ts')); // → /
  page(join(pages, 'about.ts')); // → /about
  page(join(pages, 'learn', 'index.ts')); // → /learn
  page(join(pages, 'learn', 'signals.ts')); // → /learn/signals
  page(join(pages, 'user', '[id].ts')); // dynamic → skipped
  page(join(pages, '[...rest].ts')); // catch-all → skipped

  const paths = staticRoutePaths(pages);
  ok(
    JSON.stringify(paths) === JSON.stringify(['/', '/about', '/learn', '/learn/signals']),
    `staticRoutePaths lists static routes, skips :param + * (got ${JSON.stringify(paths)})`
  );
} finally {
  rmSync(pages, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`✖ ${failures} ssg check(s) failed.`);
  process.exit(1);
}
console.log('✓ SSG build works end-to-end — root-render (E1.3b) + routed per-route (E1.3c) + route derivation.');
