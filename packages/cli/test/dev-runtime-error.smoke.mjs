/**
 * A runtime error that leaves nothing on the page must SAY so, in the page.
 *
 * A `setup()` that throws produced a blank white document: the error went to the console and the browser
 * showed an empty body. For someone on their first day that is the most confusing outcome there is —
 * nothing to read, nothing to click, no indication anything is wrong at all. The dev client already had an
 * overlay for BUILD errors; it now also paints one when an uncaught error leaves the page empty.
 *
 * Deliberately conditional on emptiness, and this test pins both halves: an app that rendered and then
 * threw keeps its screen (its console is the right place to look), and covering a working UI with a modal
 * would be a worse tool than the one that said nothing.
 *
 * Run: `node packages/cli/test/dev-runtime-error.smoke.mjs` (wired into `pnpm verify:dev-runtime-error`).
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

console.log('\npackages/cli/test/dev-runtime-error.smoke.mjs');

const devJs = join(repo, 'tools', '.verify-dev-runtime-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/dev.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: devJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { dev } = await import(pathToFileURL(devJs).href);
process.on('exit', () => rmSync(devJs, { force: true }));

/** A one-component app inside the repo (so `@weave-framework/runtime` resolves), with the given setup. */
function app(setupBody, template) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-dev-runtime-app-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  writeFileSync(join(dir, 'app.ts'), setupBody);
  writeFileSync(join(dir, 'app.html'), template);
  writeFileSync(
    join(dir, 'main.ts'),
    "import { mountComponent } from '@weave-framework/runtime/dom';\nimport App from './app';\nmountComponent(App, '#app');\n"
  );
  return dir;
}

const browser = await chromium.launch();

async function overlayFor(dir) {
  const server = await dev({ entry: join(dir, 'main.ts'), servedir: dir, outdir: dir, index: join(dir, 'index.html'), inMemory: true });
  // The first build lands asynchronously after watch() — wait for the bundle before opening the page.
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${server.url}/main.js`).catch(() => null);
    if (r && r.status === 200) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const overlay = await page.$('#__weave_error');
  const text = overlay ? await overlay.innerText() : null;
  // Read the mount point, not `body`: the dev client is an inline <script>, and its source text
  // otherwise shows up in a body-level innerText read.
  const body = (await page.innerText('#app')).trim();
  await page.close();
  await server.ctx?.dispose?.();
  return { text, body, pageErrors };
}

// 1. `setup` throws → nothing renders → the overlay explains it.
{
  const dir = app(
    "export function setup() {\n  const missing = null;\n  return { value: missing.deeply.nested };\n}\n",
    '<p>{{ value }}</p>\n'
  );
  const { text } = await overlayFor(dir);
  ok(text !== null, 'a blank page gets the overlay');
  ok(/threw before it rendered/.test(text ?? ''), `it says what happened (got ${JSON.stringify((text ?? '').slice(0, 80))})`);
  ok(/deeply/.test(text ?? ''), `it carries the real error (got ${JSON.stringify((text ?? '').slice(0, 200))})`);
  rmSync(dir, { recursive: true, force: true });
}

// 2. The app renders, then a later error throws → the screen is left alone.
{
  const dir = app(
    "export function setup() {\n  setTimeout(() => {\n    const missing = null;\n    missing.later();\n  }, 50);\n  return { value: 'RENDERED' };\n}\n",
    '<p>{{ value }}</p>\n'
  );
  const { text, body, pageErrors } = await overlayFor(dir);
  // The dev client itself must parse — a syntax error in it would silently disable the overlay AND
  // live reload, and every assertion about "no overlay" would then pass for the wrong reason.
  ok(
    !pageErrors.some((m) => /Invalid or unexpected token|SyntaxError/.test(m)),
    `the injected dev client parses (got ${JSON.stringify(pageErrors)})`
  );
  ok(body.includes('RENDERED'), `the app is on screen (got ${JSON.stringify(body)})`);
  ok(text === null, `and no overlay covers it (got ${JSON.stringify(text)})`);
  rmSync(dir, { recursive: true, force: true });
}

await browser.close();

if (failed) {
  console.error(`\n✖ ${failed} dev runtime-error check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a blank page explains itself; a rendered one is left alone\n');
process.exit(0);
