/**
 * A routed app, built with `base`, actually navigating — in a real browser, served from a real sub-path.
 *
 * The other half of `base` is the router: paths are written as if the app were at the root (`<Link
 * to="/about">`), and the basename is what turns that into `/my-app/about` in the address bar and back
 * again on a refresh. The build publishes it to the page as `__WEAVE_BASE__`, and the router reads it at
 * module init — an ordering that only holds because the declaration comes from the DOCUMENT, above the
 * entry module. Nothing short of loading the built app proves that seam works, so this loads it.
 *
 * Run: `node packages/cli/test/base-router.smoke.mjs` (wired into `pnpm verify:base-router`).
 */
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
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

console.log('\npackages/cli/test/base-router.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-base-router-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { main } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

const BASE = '/my-app';
const app = mkdtempSync(join(repo, 'tools', '.verify-base-router-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
mkdirSync(join(app, 'src', 'pages'), { recursive: true });

writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  "import { createRouter, type Router } from '@weave-framework/router';\n" +
    "import { routes } from '../pages/routes.gen';\n" +
    "import { RouterView, Link } from '@weave-framework/router';\n" +
    'void RouterView;\n' +
    'void Link;\n' +
    'const router: Router = createRouter(routes);\n' +
    'export function setup(): { router: Router } {\n  return { router };\n}\n'
);
writeFileSync(
  join(app, 'src', 'app', 'app.html'),
  '<main><nav><Link to="/about">Go</Link></nav><RouterView router={{ router }} /></main>\n'
);
writeFileSync(join(app, 'src', 'pages', 'index.ts'), 'export function setup(): { t: string } {\n  return { t: "HOME" };\n}\n');
writeFileSync(join(app, 'src', 'pages', 'index.html'), '<p>{{ t }}</p>\n');
writeFileSync(join(app, 'src', 'pages', 'about.ts'), 'export function setup(): { t: string } {\n  return { t: "ABOUT" };\n}\n');
writeFileSync(join(app, 'src', 'pages', 'about.html'), '<p>{{ t }}</p>\n');
writeFileSync(
  join(app, 'weave.config.ts'),
  "import { defineConfig } from '@weave-framework/cli';\n" +
    `export default defineConfig({ root: 'src/app/app', index: 'src/index.html', routesDir: 'src/pages', base: '${BASE}/', outDir: 'dist' });\n`
);

const cwd = process.cwd();
process.chdir(app);
await main(['build']);
process.chdir(cwd);

const dist = join(app, 'dist');
ok(existsSync(join(dist, '404.html')), 'a routed app got its SPA fallback');

// Serve dist under the sub-path, the way the host would.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (!path.startsWith(BASE)) {
    res.writeHead(404).end('not under the base');
    return;
  }
  const rel = path.slice(BASE.length).replace(/^\//, '');
  const file = join(dist, rel);
  const target = rel && existsSync(file) && extname(file) ? file : join(dist, '404.html'); // the host's own fallback
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'text/plain' });
  res.end(readFileSync(target));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
ok((await page.innerText('#app')).includes('HOME'), `the index route rendered under the base (got ${JSON.stringify(await page.innerText('#app'))})`);
ok(errors.length === 0, `no page errors (got ${JSON.stringify(errors)})`);

// The link is written as `/about`; the basename is what makes it resolve under the sub-path.
const href = await page.getAttribute('a', 'href');
ok(href === `${BASE}/about`, `<Link to="/about"> renders href="${BASE}/about" (got ${href})`);

await page.click('a');
await page.waitForTimeout(300);
ok(new URL(page.url()).pathname === `${BASE}/about`, `navigation lands under the base (got ${new URL(page.url()).pathname})`);
ok((await page.innerText('#app')).includes('ABOUT'), `and renders the route (got ${JSON.stringify(await page.innerText('#app'))})`);

// A refresh on the deep link: the host answers with 404.html, and the app has to resolve `/about` again.
await page.reload({ waitUntil: 'networkidle' });
ok((await page.innerText('#app')).includes('ABOUT'), `a deep-link refresh still renders it (got ${JSON.stringify(await page.innerText('#app'))})`);

await browser.close();
server.close();
rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error(`\n✖ ${failed} base-router check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a routed app served from a sub-path navigates and survives a refresh\n');
process.exit(0);
