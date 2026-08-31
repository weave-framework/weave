/**
 * Hosting under a sub-path — a GitHub Pages project site, `/docs/`, a reverse proxy — and cache-busting.
 *
 * The build injected root-absolute asset URLs (`/main.js`, `/app.css`) and nothing else. Deploy that to
 * `user.github.io/my-app/` — which `learn/installation` recommends by name — and the browser asks for
 * `user.github.io/main.js`, gets a 404, and shows a white page. There was no way to say where the app is
 * served from.
 *
 * The same injection carried no version marker either, so a CDN holding `main.js` served yesterday's
 * bundle against today's HTML for as long as its TTL ran.
 *
 * Run: `node packages/cli/test/base-path.smoke.mjs` (wired into `pnpm verify:base-path`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

console.log('\npackages/cli/test/base-path.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-base-path-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/build.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { build } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

/** A one-component app, built with the given base. Returns the emitted index.html.
 *  `dir` can be reused so a second build sees the SAME paths — a component's scope hash is derived from
 *  its filename, so two builds in two temp dirs differ in content by construction. */
async function buildApp(base, existing, template = '<p>{{ n() }}</p>\n', spaFallback = false) {
  const dir = existing ?? mkdtempSync(join(repo, 'tools', '.verify-base-path-app-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  writeFileSync(join(dir, 'src', 'app.ts'), "import { signal } from '@weave-framework/runtime';\nexport function setup() {\n  const n = signal(1);\n  return { n };\n}\n");
  writeFileSync(join(dir, 'src', 'app.html'), template);
  writeFileSync(join(dir, 'src', 'main.ts'), "import { mountComponent } from '@weave-framework/runtime/dom';\nimport App from './app';\nmountComponent(App, '#app');\n");
  writeFileSync(join(dir, 'src', 'app.css'), '.x { color: red }\n');
  await build({
    entry: join(dir, 'src', 'main.ts'),
    outDir: join(dir, 'dist'),
    index: join(dir, 'src', 'index.html'),
    minify: true,
    base,
    spaFallback,
    clean: true,
  });
  const html = readFileSync(join(dir, 'dist', 'index.html'), 'utf8');
  if (!existing) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return html;
}

// 1. No base: exactly what it always emitted, plus a version marker.
{
  const html = await buildApp(undefined);
  // The version lives in the NAME now, not in a query: a stable name can never be served as
  // immutable, however correct its `?v=` is.
  ok(/src="\/main-[A-Za-z0-9]+\.js"/.test(html), `the entry name carries its content version (got ${(/src="[^"]*"/.exec(html) ?? [])[0]})`);
  ok(/href="\/app-[A-Za-z0-9]+\.css"/.test(html), `the stylesheet's does too (got ${(/href="[^"]*\.css[^"]*"/.exec(html) ?? [])[0]})`);
}

// 2. A base prefixes every framework-injected URL.
{
  const html = await buildApp('/my-app/');
  // Asset names carry a content hash now, so these assert the SHAPE — served from the base, and a
  // hashed name rather than a stable one with a query. Spelling `main.js` out was asserting a
  // coincidence, and it broke the day the build stopped choosing that name.
  ok(/src="\/my-app\/main-[A-Za-z0-9]+\.js"/.test(html), `the entry is served from the base (got ${(/src="[^"]*"/.exec(html) ?? [])[0]})`);
  ok(/href="\/my-app\/app-[A-Za-z0-9]+\.css"/.test(html), `so is the stylesheet (got ${(/href="[^"]*\.css[^"]*"/.exec(html) ?? [])[0]})`);
  ok(!/src="\/main-/.test(html), 'and nothing is left at the root');

  // The router reads the base at module init, and `import` declarations hoist — so the declaration has
  // to come from the DOCUMENT, before the entry module tag. Order is the whole point of this assertion.
  const declared = html.indexOf('__WEAVE_BASE__');
  const entry = html.search(/src="\/my-app\/main-/);
  ok(declared !== -1, 'the page declares the base for the router');
  ok(declared < entry, `and declares it BEFORE the entry module (${declared} < ${entry})`);
  ok(/__WEAVE_BASE__="\/my-app"/.test(html), `with no trailing slash (got ${(/__WEAVE_BASE__=[^<]*/.exec(html) ?? [])[0]})`);
}

// 3. The version tracks the CONTENT — stable across a rebuild of the same sources (nothing re-downloads
//    for no reason), and different once the sources change (or the whole mechanism is decoration).
{
  const dir = mkdtempSync(join(repo, 'tools', '.verify-base-path-app-'));
  const version = (html) => /main-([A-Za-z0-9]+)\.js/.exec(html)?.[1];

  const first = version(await buildApp(undefined, dir));
  const again = version(await buildApp(undefined, dir));
  ok(Boolean(first) && first === again, `a rebuild of the same sources keeps the version (${first} vs ${again})`);

  const changed = version(await buildApp(undefined, dir, '<p>{{ n() }} CHANGED</p>' + String.fromCharCode(10)));
  ok(Boolean(changed) && changed !== first, `a changed source gets a new version (${first} → ${changed})`);

  // Windows holds the just-written bundle briefly; retry rather than fail the run on cleanup.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// 4. An app with client routes gets the shell under `404.html` too — the only way a deep-link refresh
//    survives on a host that cannot be given rewrite rules (GitHub Pages serves 404.html).
{
  const dir = mkdtempSync(join(repo, 'tools', '.verify-base-path-app-'));
  await buildApp(undefined, dir, undefined, true);
  const shell = readFileSync(join(dir, 'dist', 'index.html'), 'utf8');
  const fallback = readFileSync(join(dir, 'dist', '404.html'), 'utf8');
  ok(fallback === shell, 'the SPA fallback is the same document as the shell');

  await buildApp(undefined, dir, undefined, false);
  let exists = true;
  try {
    readFileSync(join(dir, 'dist', '404.html'), 'utf8');
  } catch {
    exists = false;
  }
  ok(!exists, 'and an app without client routes gets no stray 404.html');

  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

if (failed) {
  console.error(`\n✖ ${failed} base-path check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a sub-path deploy resolves, and assets carry a content version\n');
process.exit(0);
