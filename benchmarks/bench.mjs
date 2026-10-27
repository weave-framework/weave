/**
 * Benchmark runner. Bundles `harness.js` (vanilla + Weave row operations) with
 * esbuild, runs it in headless Chromium via Playwright, and prints a table of
 * median times plus Weave's slowdown factor over the vanilla baseline.
 *
 *   node benchmarks/bench.mjs            # human table
 *   node benchmarks/bench.mjs --json     # machine-readable JSON
 *
 * The slowdown factor (weave ÷ vanilla, same machine) is the figure that is fair to
 * compare against the public js-framework-benchmark, whose published numbers are
 * likewise normalised to a vanilla baseline. Absolute ms are machine-specific.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const json = process.argv.includes('--json');
const root = fileURLToPath(new URL('..', import.meta.url));

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./harness.js', import.meta.url))],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  absWorkingDir: root,
});

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
if (errs.length) {
  console.error('Harness error:\n  ' + errs.join('\n  '));
  await browser.close();
  process.exit(1);
}
const results = await page.evaluate(() => globalThis.__bench());
await browser.close();

if (json) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n) => v.toFixed(2).padStart(n);
console.log('\nWeave vs vanilla JS — median of many reps, headless Chromium\n');
// Two Weave columns: a bare `<tr>` row, and a component per row (what real applications write).
console.log(pad('operation', 24) + pad('vanilla ms', 12) + pad('weave ms', 12) + pad('slowdown', 10) + pad('component ms', 14) + 'slowdown');
console.log('-'.repeat(82));
const fx = (f) => (f == null ? '   —' : f.toFixed(2) + '×');
for (const r of results) {
  console.log(pad(r.label, 24) + num(r.vanilla, 8) + '    ' + num(r.weave, 8) + '    ' + pad(fx(r.factor), 10) + num(r.component, 10) + '    ' + fx(r.componentFactor));
}
const rated = results.filter((r) => r.factor != null);
const geo = Math.exp(rated.reduce((s, r) => s + Math.log(r.factor), 0) / rated.length);
const geoC = Math.exp(rated.reduce((s, r) => s + Math.log(r.componentFactor), 0) / rated.length);
console.log('-'.repeat(82));
console.log(pad('geometric mean (rated ops)', 48) + pad(geo.toFixed(2) + '×', 10) + pad('', 14) + geoC.toFixed(2) + '×');
console.log('\n(slowdown = weave ÷ vanilla on this machine — comparable to js-framework-benchmark factors)\n');
