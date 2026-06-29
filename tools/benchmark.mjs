/**
 * Phase C — reconcile performance benchmark over the demo's `/stress` route.
 *
 * Builds the demo, serves `dist/`, and drives the shipped `/stress` page in a real
 * browser through the standard js-framework-benchmark operations. Each op is timed
 * BY THE PAGE ITSELF: `/stress` wraps every mutation in `batch` and brackets it with
 * `performance.now()` (Weave's updates are synchronous, so the DOM is settled the
 * moment `batch` returns) and writes the result to `.last-ms`. We run each op a few
 * warmup + several measured times and report min / median / mean.
 *
 * Beyond the raw numbers it asserts a few HARDWARE-INDEPENDENT invariants that prove
 * the reconcile is genuinely fine-grained (keyed, minimal-move) rather than a full
 * re-render: a 2-node swap, a single remove, and a partial text update must each cost
 * no more than a full 1,000-row create, and a 2-node swap no more than a full shuffle.
 * Those hold on any machine because the cheaper op physically touches fewer nodes; if
 * one regresses (e.g. swap starts re-rendering the list), the benchmark fails loudly.
 *
 * Run: `pnpm bench` (or `node tools/benchmark.mjs`). Reports only, except the
 * invariant checks, which exit non-zero on violation.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'examples/demo/dist');

/* ── 1. Build the demo (the real shipped bundle, not dev) ── */
console.log('building demo…');
await new Promise((resolve, reject) => {
  const proc = spawn(
    process.execPath,
    ['packages/cli/bin/weave.mjs', 'build', '--config', 'examples/demo/weave.config.ts'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
  );
  proc.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`weave build failed (${c})`))));
});

/* ── 2. Serve dist/ with an SPA fallback (so `/stress` deep-links) ── */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = normalize(join(dist, p === '/' ? 'index.html' : p));
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    if (!extname(p)) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(join(dist, 'index.html')));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  }
});
const port = 5194;
await new Promise((r) => server.listen(port, r));
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const results = {};
let failed = false;

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${base}/stress`, { waitUntil: 'load' });
  await page.waitForSelector('.stress-bar', { timeout: 10000 });

  const op = (name) => `button[data-op="${name}"]`;
  const rowCount = () => page.locator('.stress-table tbody tr').count();
  const lastMs = async () => parseFloat(await page.locator('.last-ms').textContent());

  /** Run `opSelector` (re-establishing `setup` each time); record measured samples. */
  async function bench(label, opSelector, { setup, runs = 8, warmup = 2 } = {}) {
    const samples = [];
    for (let i = 0; i < warmup + runs; i++) {
      if (setup) await setup();
      await page.click(opSelector);
      const ms = await lastMs();
      if (i >= warmup && Number.isFinite(ms)) samples.push(ms);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    results[label] = { min: samples[0], median, mean, n: samples.length };
    return median;
  }

  const clear = () => page.click(op('clear'));
  const create1k = () => page.click(op('create-1k'));
  const ensure1k = async () => {
    await create1k();
    if ((await rowCount()) !== 1000) throw new Error('precondition: expected 1000 rows');
  };

  console.log(`\nbenchmarking ${base}/stress …\n`);

  await bench('create 1k (from empty)', op('create-1k'), { setup: clear });
  await bench('replace 1k', op('create-1k'), { setup: create1k });
  await bench('update every 10th (of 1k)', op('update-10th'), { setup: ensure1k });
  await bench('swap 2 rows (in 1k)', op('swap'), { setup: ensure1k });
  await bench('shuffle 1k', op('shuffle'), { setup: ensure1k });
  await bench('remove 1 row (from 1k)', '.stress-table tbody tr:first-child .remove', { setup: ensure1k });
  await bench('append 1k (1k → 2k)', op('append-1k'), { setup: ensure1k });
  await bench('create 10k (from empty)', op('create-10k'), { setup: clear, runs: 4, warmup: 1 });
  await bench('clear 10k', op('clear'), {
    setup: async () => {
      await page.click(op('create-10k'));
      if ((await rowCount()) !== 10000) throw new Error('precondition: expected 10000 rows');
    },
    runs: 3,
    warmup: 1,
  });

  /* ── report ── */
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1).padStart(7) : '    —  ');
  console.log('  operation                      min     median    mean    (n)');
  console.log(`  ${'─'.repeat(58)}`);
  for (const [label, r] of Object.entries(results)) {
    console.log(`  ${label.padEnd(28)} ${fmt(r.min)} ${fmt(r.median)} ${fmt(r.mean)}   ${r.n}`);
  }
  console.log('\n  (ms; page-measured synchronous reconcile via performance.now() around batch)\n');

  /* ── invariants: prove the reconcile is fine-grained, not a full re-render ── */
  const ok = (cond, msg) => {
    console.log(`  ${cond ? '✔' : '✖'} ${msg}`);
    if (!cond) failed = true;
  };
  const m = (k) => results[k].median;
  const create = m('create 1k (from empty)');
  ok(m('swap 2 rows (in 1k)') <= create, `swap (2 nodes) ≤ create 1k  (${fmt(m('swap 2 rows (in 1k)')).trim()} ≤ ${fmt(create).trim()} ms)`);
  ok(m('remove 1 row (from 1k)') <= create, `remove (1 node) ≤ create 1k  (${fmt(m('remove 1 row (from 1k)')).trim()} ≤ ${fmt(create).trim()} ms)`);
  ok(m('update every 10th (of 1k)') <= create, `update 100 texts ≤ create 1k  (${fmt(m('update every 10th (of 1k)')).trim()} ≤ ${fmt(create).trim()} ms)`);
  ok(m('swap 2 rows (in 1k)') <= m('shuffle 1k'), `swap (2 moves) ≤ shuffle (full reorder)  (${fmt(m('swap 2 rows (in 1k)')).trim()} ≤ ${fmt(m('shuffle 1k')).trim()} ms)`);

  ok(errors.length === 0, errors.length ? `page errors: ${errors.join('; ')}` : 'no page errors during the run');
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${'─'.repeat(60)}`);
if (failed) {
  console.error('benchmark: a fine-grained-reconcile invariant FAILED');
  process.exit(1);
}
console.log('benchmark complete ✓');
