/**
 * D.7 — end-to-end integration test for the Weave Board demo.
 *
 * Unlike the `*.browser.ts` unit tests (which mount one compiled component into a
 * blank page), this drives the REAL shipped app: it `weave build`s the demo, serves
 * the `dist/` over HTTP with an SPA fallback, and exercises the full stack in a real
 * browser — router + code-split lazy chunks, store, optimistic create, forms +
 * `form.submit`, the Portal/transition modal + toast, the `@defer` insights panel,
 * the error boundary, and the perf stress route — including a cold deep-link load.
 *
 * Run: `pnpm verify:demo` (or `node tools/verify-demo.mjs`).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'examples/demo/dist');

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed = true;
  } else {
    console.log(`✔ ${msg}`);
  }
};
let failed = false;

/* ── 1. Build the demo (self-contained: prove the real build, not dev) ── */
console.log('building demo…');
await new Promise((resolve, reject) => {
  const proc = spawn(
    process.execPath,
    ['packages/cli/bin/weave.mjs', 'build', '--config', 'examples/demo/weave.config.ts'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
  );
  proc.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`weave build failed (${c})`))));
});

/* ── 2. Serve dist/ with an SPA fallback (deep links → index.html) ── */
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = normalize(join(dist, p === '/' ? 'index.html' : p));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback: a path with no file extension is a client route → serve the shell.
    if (!extname(p)) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(join(dist, 'index.html')));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  }
});
const port = 5193;
await new Promise((r) => server.listen(port, r));
const base = `http://localhost:${port}`;
console.log(`serving dist at ${base}\n`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* ── 3. Board: route + lazy chunk + store load ── */
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.card', { timeout: 10000 });
  const initialCards = await page.locator('.card').count();
  ok(initialCards === 6, `board loaded ${initialCards} seed cards (expect 6)`);
  ok(
    (await page.locator('.nav a', { hasText: 'Board' }).getAttribute('aria-current')) === 'page' &&
      (await page.locator('.nav a', { hasText: 'Stress' }).getAttribute('aria-current')) === null,
    'active-link: the Board nav link is current at /, Stress is not'
  );
  ok((await page.locator('.summary').textContent())?.includes('2 / 6 done'), 'progress summary reads "2 / 6 done"');

  // The @defer (on idle) insights panel resolves after the columns.
  await page.waitForSelector('.insights .insights-title', { timeout: 10000 });
  ok(true, '@defer insights panel resolved');

  /* ── 4. Debounced filter narrows the board ── */
  await page.fill('.search', 'sketch');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1, { timeout: 3000 });
  ok(true, 'debounced filter narrows to the 1 matching card');
  await page.fill('.search', '');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 6, { timeout: 3000 });
  ok(true, 'clearing the filter restores all cards');

  /* ── 5. Optimistic create through the modal (Portal + forms + toast) ── */
  await page.click('.new-task');
  await page.waitForSelector('.tm-dialog input[type="text"]', { timeout: 5000 });
  await page.fill('.tm-dialog input[type="text"]', 'Integration smoke task');
  await page.click('.tm-dialog button[type="submit"]');
  await page.waitForSelector('.toast.success', { timeout: 5000 });
  ok((await page.locator('.toast-msg').first().textContent())?.includes('Created'), 'success toast says "Created …"');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 7, { timeout: 5000 });
  ok(true, 'optimistic create added a 7th card');
  ok(
    (await page.locator('.card .title', { hasText: 'Integration smoke task' }).count()) === 1,
    'the new card shows the entered title'
  );

  /* ── 6. Navigate to a task detail (lazy route via in-app Link) ── */
  await page.locator('.columns .card-wrap a').first().click();
  await page.waitForFunction(() => location.pathname.startsWith('/task/'), { timeout: 5000 });
  await page.waitForSelector('.detail', { timeout: 5000 });
  ok(/^\/task\//.test(new URL(page.url()).pathname), 'clicking a card navigates to /task/:id');

  /* ── 7. Error boundary catches a throwing route ── */
  await page.goto(`${base}/boom`, { waitUntil: 'load' });
  await page.waitForSelector('.route-error', { timeout: 5000 });
  ok((await page.locator('.route-error p').textContent())?.includes('Boom!'), 'error boundary renders the route fault');

  /* ── 8. Wildcard 404 (file-based [...rest] → path '*') ── */
  await page.goto(`${base}/no-such-page`, { waitUntil: 'load' });
  await page.waitForSelector('.notfound', { timeout: 5000 });
  ok((await page.locator('.nf-code').textContent()) === '404', 'unknown path falls through to the 404 page');

  /* ── 9. Perf stress route — COLD deep-link (SPA fallback + lazy chunk) ── */
  await page.goto(`${base}/stress`, { waitUntil: 'load' });
  await page.waitForSelector('.stress-bar', { timeout: 5000 });
  ok((await page.locator('.stress code').textContent()) === '@for', '@@ escape renders a literal @for in prose');

  await page.click('button[data-op="create-1k"]');
  await page.waitForFunction(() => document.querySelectorAll('.stress-table tbody tr').length === 1000, { timeout: 5000 });
  ok(true, 'create 1,000 renders 1000 keyed rows');

  await page.click('button[data-op="swap"]');
  const swapped = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.stress-table tbody .cell-id')];
    return { a: rows[1].textContent, b: rows[998].textContent };
  });
  ok(swapped.a === '999' && swapped.b === '2', 'swap rows exchanges row 1 ↔ 998 by key (minimal moves)');

  await page.click('button[data-op="clear"]');
  await page.waitForFunction(() => document.querySelector('.stress-empty') !== null, { timeout: 5000 });
  ok((await page.locator('.rows-count').textContent()) === '0', 'clear empties the list (@empty shown)');

  /* ── 10. Router R.3 — document title (afterEach) + scroll-to-top on navigate ── */
  ok((await page.title()).includes('Stress'), 'afterEach set the document title to the route');
  await page.click('button[data-op="create-1k"]'); // make the page tall enough to scroll
  await page.waitForFunction(() => document.querySelectorAll('.stress-table tbody tr').length === 1000, { timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.click('.nav a[href="/"]'); // real <Link> navigation → push
  await page.waitForFunction(() => location.pathname === '/' && window.scrollY === 0, { timeout: 5000 });
  ok(true, 'navigating to a new route scrolls back to the top');

  ok(errors.length === 0, errors.length ? `no page errors (got: ${errors.join('; ')})` : 'no page errors during the run');
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${'-'.repeat(40)}`);
if (failed) {
  console.error('demo integration test FAILED');
  process.exit(1);
}
console.log('demo integration test passed ✓');
