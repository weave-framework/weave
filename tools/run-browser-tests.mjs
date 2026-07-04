/**
 * Browser test runner: finds every `*.browser.ts` under packages/, bundles each
 * with esbuild (resolving @weave-framework/* workspace imports), runs it in headless
 * Chromium via Playwright, and reports pass/fail. Replaces jsdom entirely —
 * tests execute against a real DOM.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTests(full));
    else if (entry.endsWith('.browser.ts')) out.push(full);
  }
  return out;
}

// Optional substring filters from argv — `node tools/run-browser-tests.mjs forms devtools`
// runs only test files whose path contains one of the given substrings. No args = all.
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let files = findTests(join(root, 'packages')).sort();
if (filters.length) files = files.filter((f) => filters.some((s) => f.includes(s)));
if (files.length === 0) {
  console.error(filters.length ? `No *.browser.ts test files match: ${filters.join(', ')}` : 'No *.browser.ts test files found.');
  process.exit(1);
}

const browser = await chromium.launch();
let totalPassed = 0;
let totalFailed = 0;

for (const file of files) {
  const rel = relative(root, file);
  const bundle = await build({
    entryPoints: [file],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  const code = bundle.outputFiles[0].text;

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: code });

  if (pageErrors.length) {
    console.error(`\n✖ ${rel} — script error:\n  ${pageErrors.join('\n  ')}`);
    totalFailed++;
    await page.close();
    continue;
  }

  const { passed, failed, results } = await page.evaluate(() => globalThis.__weaveRun());
  totalPassed += passed;
  totalFailed += failed;

  console.log(`\n${rel}`);
  for (const r of results) {
    console.log(r.ok ? `  ✔ ${r.name}` : `  ✖ ${r.name}\n      ${r.error}`);
  }
  await page.close();
}

await browser.close();

console.log(`\n${'-'.repeat(40)}`);
console.log(`tests ${totalPassed + totalFailed}  pass ${totalPassed}  fail ${totalFailed}`);
process.exit(totalFailed > 0 ? 1 : 0);
