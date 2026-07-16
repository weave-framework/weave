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
  // Re-exporting from runtime/graph forces its module (and its top-level signal (de)serializer registration)
  // into this bundle, so the embedded snapshot round-trips here. A bare side-effect import gets tree-shaken.
  export { ROOT_ID } from '@weave-framework/runtime/graph';
  export { deserialize } from '@weave-framework/runtime/serialize';
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
const { generateServerEntry, generateEntry, discoverCustomElements, buildSsg, staticRoutePaths, deserialize } = await import(pathToFileURL(out).href);

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

// The eager client entry is a CSR mount — the server HTML is a first-paint shell for a remount.
const client = generateEntry(join(rootDir, 'App.ts'), '#app', rootDir, []);
ok(client.includes('mountComponent(Root, "#app")'), 'client entry (eager): CSR mountComponent at the mount selector');
ok(!client.includes('resumePage'), 'eager client entry does NOT resume');

// E1.4 — the RESUMABLE entry generators (islands). Server: renderPage captures the state map; client: adopt.
const resumableServer = generateServerEntry(join(rootDir, 'App.ts'), rootDir, { resumable: true });
ok(/export function render\(\)\s*\{\s*return renderPage\(Root, \{ resumable: true \}\);\s*\}/.test(resumableServer),
  'resumable server entry: render() → renderPage(Root, { resumable: true })');
const routedResumable = generateServerEntry(join(rootDir, 'App.ts'), rootDir, { routed: true, resumable: true });
ok(routedResumable.includes('setServerLocation') && routedResumable.includes('renderPage(Root, { resumable: true })'),
  'routed + resumable server entry: seeds location AND captures the state map');

const resumeClient = generateEntry(join(rootDir, 'App.ts'), '#app', rootDir, [], { resume: true });
ok(resumeClient.includes('import { resumePage } from "@weave-framework/runtime/graph"'), 'resume client entry: imports resumePage');
ok(resumeClient.includes('_m.firstElementChild') && /resumePage\(\{ root: _r, adopt: Root\.adopt, handlers: Root\.handlers, derive: Root\.derive, fallback: _csr \}\)/.test(resumeClient),
  'resume client entry: resumePage adopts the mount target\'s first child with Root.adopt + .handlers + .derive');
// E1.9 — the entry ALSO carries a CSR fallback, for a root the server could not make resumable (e.g. a
// `router` binding that cannot be serialized). Without it such a page would throw instead of degrading.
ok(/_csr = \(\) => \{ if \(_m\) \{ _m\.textContent = ""; mountComponent\(Root, _m\); \} \};/.test(resumeClient),
  'resume client entry: carries a CSR fallback (clear + mountComponent) for a non-resumable root');
ok(resumeClient.includes('else _csr();'), 'resume client entry: no prerendered DOM at all → CSR');

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

/* ── Part 3b — E1.12: a ROUTED page resumes (the router is re-derived; the view adopts in place) ── */

const rrapp = mkdtempSync(join(here, '.smoke-ssg-rr-'));
const rrout = mkdtempSync(join(here, '.smoke-ssg-rrout-'));
try {
  writeFileSync(
    join(rrapp, 'home.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';
` +
      `export const template = '<section><b id="n">{{ n() }}</b><button on:click={{ bump }}>+1</button></section>';
` +
      `export function setup(): { n: Signal<number>; bump: () => void } {
` +
      `  const n = signal(7);
  const bump = () => n.set((v) => v + 1);
  return { n, bump };
}
`
  );
  writeFileSync(join(rrapp, 'app.ts'),
    `import { createRouter, route, RouterView } from '@weave-framework/router';
` +
      `import Home from './home';
` +
      `export const template = '<main><RouterView router={{ router }} /></main>';
` +
      `export function setup() {
  const router = createRouter([ route('/', { component: Home }) ]);
  return { router };
}
`
  );

  const rootComponent = join(rrapp, 'app.ts');
  await buildSsg({
    virtualEntry: { code: generateEntry(rootComponent, '#app', rrapp, [], { resume: true }), resolveDir: rrapp },
    serverEntry: { code: generateServerEntry(rootComponent, rrapp, { routed: true, resumable: true }), resolveDir: rrapp },
    mount: '#app', routes: ['/'], outDir: rrout, minify: false, styleLang: 'css', resume: true,
  });

  const doc = readFileSync(join(rrout, 'index.html'), 'utf8');
  const json = (doc.match(/id="__weave_snapshot__">([^<]*)/) || [])[1].replace(/\u003c/g, '<');
  const state = deserialize(JSON.parse(json));
  // The router made the root unserializable BEFORE E1.11 (the build actually failed). Now it is re-derived
  // client-side, so the root IS captured — and E1.12 captures the routed view's ctx under $route:0.
  ok(state && '$root' in state, 'routed resume: the root is resumable (the router is re-derived, not serialized)');
  ok(state && '$route:0' in state, "routed resume: the VIEW's ctx is captured under $route:0 (RouterView tags it with $wid)");
  ok(state && typeof state['$route:0'].n === 'function' && state['$route:0'].n() === 7, "routed resume: the view's signal round-trips @ 7");
  ok(!/data-won-click/.test(doc) === false, 'routed resume: the view keeps its resumable event marker in the server HTML');
} finally {
  rmSync(rrapp, { recursive: true, force: true });
  rmSync(rrout, { recursive: true, force: true });
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

/* ── Part 5 — E1.4 ISLANDS: buildSsg({ resume: true }) — resumable bundles, embedded state map, adopt client ── */

const iapp = mkdtempSync(join(here, '.smoke-ssg-iapp-'));
const iout = mkdtempSync(join(here, '.smoke-ssg-iout-'));
try {
  // A real interactive component: setup returns a writable signal AND a handler function. The handler must NOT
  // break the snapshot (it is dropped as non-state) — the whole build completing proves the strip works.
  writeFileSync(
    join(iapp, 'App.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';\n` +
      `export function setup(): { count: Signal<number>; inc: () => void } {\n` +
      `  const count = signal(3);\n` +
      `  const inc = () => count.set((n) => n + 1);\n` +
      `  return { count, inc };\n}\n`
  );
  writeFileSync(
    join(iapp, 'App.html'),
    `<main class="app"><h1>Islands</h1><button on:click={{ inc }}>count {{ count() }}</button></main>`
  );

  const rootComponent = join(iapp, 'App.ts');
  await buildSsg({
    virtualEntry: { code: generateEntry(rootComponent, '#app', iapp, discoverCustomElements(iapp), { resume: true }), resolveDir: iapp },
    serverEntry: { code: generateServerEntry(rootComponent, iapp, { resumable: true }), resolveDir: iapp },
    mount: '#app',
    outDir: iout,
    minify: false,
    styleLang: 'css',
    title: 'Islands',
    lang: 'en',
    resume: true,
  });

  const index = join(iout, 'index.html');
  ok(existsSync(index), 'islands: index.html was written (build completed — the handler function did not break the snapshot)');
  const doc = existsSync(index) ? readFileSync(index, 'utf8') : '';

  // (a) the server render used the RESUMABLE target: data-won event marker + dynamic-text marker in the HTML
  ok(/data-won-click="w0#\d+"/.test(doc), 'islands: resumable event marker (data-won-click) in the server HTML');
  ok(doc.includes('<!--$-->'), 'islands: dynamic-text marker isolates the reactive text for adopt');
  ok(/count <!--\$-->3<!---->/.test(doc), 'islands: server evaluated the binding (count() → 3, isolated by its marker)');

  // (b) the embedded snapshot is the per-instance MAP — $root present, count round-trips, inc dropped
  const m = doc.match(/<script type="application\/weave" id="__weave_snapshot__">([\s\S]*?)<\/script>/);
  ok(!!m, 'islands: the snapshot <script> is embedded');
  const wire = m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null;
  const state = wire ? deserialize(wire) : null;
  ok(state && typeof state === 'object' && '$root' in state, 'islands: snapshot is the instance-state map (has $root)');
  ok(state && typeof state.$root.count === 'function' && state.$root.count() === 3, 'islands: $root.count round-trips as a live signal @ 3');
  ok(state && !('inc' in state.$root), 'islands: the handler `inc` was dropped from the captured state (re-derived on the client)');

  // (c) the client bundle is the RESUME entry (adopts). It also bundles mountComponent for the E1.9 CSR
  // fallback, so presence of `resumePage` — not absence of mountComponent — is what proves the resume entry.
  const mainJs = readFileSync(join(iout, 'main.js'), 'utf8');
  ok(mainJs.includes('resumePage'), 'islands: client bundle resumes (resumePage) rather than plain CSR-mounting');
} finally {
  rmSync(iapp, { recursive: true, force: true });
  rmSync(iout, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`✖ ${failures} ssg check(s) failed.`);
  process.exit(1);
}
console.log('✓ SSG build works end-to-end — root-render (E1.3b) + routed (E1.3c) + route derivation + islands resume (E1.4).');
