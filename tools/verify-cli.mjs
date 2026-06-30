/**
 * M7b proof: the shipped `@weave/cli` plugin drives both `weave build`
 * (one-shot bundle) and `weave dev` (watch + serve + live-reload), and the
 * output mounts + reacts + is scoped in a real browser.
 *
 * Part A loads the already-built `examples/__fixtures__/v2/dist` bundle headless.
 * Part B starts `weave dev` for real and drives the live server with Playwright.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

const browser = await chromium.launch();

/* ── Part A: the production bundle runs ── */
{
  const js = readFileSync('examples/__fixtures__/v2/dist/main.js', 'utf8');
  const css = readFileSync('examples/__fixtures__/v2/dist/app.css', 'utf8');
  ok(css.includes('[data-w-'), 'build: app.css is scoped');

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body><div id="app"></div></body></html>`
  );
  await page.addScriptTag({ content: js, type: 'module' });
  await page.waitForSelector('#app button');
  const btn = page.locator('#app button');
  ok((await btn.textContent()) === 'count: 0', 'build: component mounted');
  ok((await btn.evaluate((el) => getComputedStyle(el).color)) === 'rgb(0, 128, 0)', 'build: scoped CSS applied');
  await btn.click();
  ok((await btn.textContent()) === 'count: 1', 'build: reactive click');
  await page.close();
}

/* ── Part B: the dev server serves + mounts ── */
{
  const port = 5191;
  const proc = spawn(
    process.execPath,
    ['packages/cli/bin/weave.mjs', 'dev', 'examples/__fixtures__/v2/main.ts', '--serve', 'examples/__fixtures__/v2', '--out', 'examples/__fixtures__/v2', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server did not start in time')), 20000);
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/weave dev → (\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (c) => reject(new Error(`dev exited early (${c})`)));
  });
  ok(true, `dev: server up at ${url}`);

  try {
    const page = await browser.newPage();
    // 'load' not 'networkidle' — the live-reload SSE keeps a connection open.
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#app button', { timeout: 10000 });
    const btn = page.locator('#app button');
    ok((await btn.textContent()) === 'count: 0', 'dev: component mounted via live server');
    ok((await btn.evaluate((el) => getComputedStyle(el).color)) === 'rgb(0, 128, 0)', 'dev: scoped CSS served + applied');
    await btn.click();
    ok((await btn.textContent()) === 'count: 1', 'dev: reactive click');
    await page.close();
  } finally {
    proc.kill();
  }
}

await browser.close();
console.log('\nM7b CLI (build + dev) verified.');
