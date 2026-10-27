/**
 * `weave dev --keep-state` — a save no longer throws the screen away.
 *
 * Live reload is a full page reload: the filled form, the open dialog, the tenth page of the list all go
 * back to the start on every save, and the developer drives the app there again by hand. The dev server
 * already knows how to capture and apply a state (the devtools States tab, `--state <name>`); this is the
 * same mechanism on the reload path. Before the page reloads, the client saves the named signals; the fresh
 * page applies them once, right after the mount, and only on a load that a reload caused (a flag in
 * sessionStorage), so a new tab or a new dev session starts clean.
 *
 * Pinned with a real server and a real browser: the app is driven somewhere by clicking, a file is saved,
 * the page reloads (the edit is visible), and the number is still there. The control runs the same fixture
 * without the flag: the edit is visible and the number is back at the start — or the first assertion would
 * pass for an app that never reloaded.
 *
 * Run: `node packages/cli/test/dev-keep-state.smoke.mjs` (wired into `pnpm verify:dev-keep-state`).
 */
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/dev-keep-state.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-keep-state-bundle.mjs');
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

const NL = String.fromCharCode(10);
const mkApp = () => {
  const app = mkdtempSync(join(repo, 'tools', '.verify-keep-state-app-'));
  mkdirSync(join(app, 'src', 'app'), { recursive: true });
  writeFileSync(
    join(app, 'src', 'app', 'app.ts'),
    [
      "import { signal } from '@weave-framework/runtime';",
      'export function setup() {',
      "  const count = signal(41, { name: 'count' });",
      '  const bump = (): void => void count.set(count() + 1);',
      '}',
      '',
    ].join(NL)
  );
  writeFileSync(join(app, 'src', 'app', 'app.html'), template('v1'));
  writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  writeFileSync(
    join(app, 'weave.config.ts'),
    "import { defineConfig } from '@weave-framework/cli';" +
      NL +
      "export default defineConfig({ root: 'src/app/app', index: 'src/index.html', outDir: 'dist' });" +
      NL
  );
  return app;
};
const template = (v) => `<main><p id="n">{{ count() }}</p><p id="v">${v}</p><button id="b" on:click={{ bump }}>+</button></main>` + NL;

/** Start `weave dev` in `app` and hand back the URL it prints. */
const start = async (app, args) => {
  const said = [];
  const realLog = console.log;
  const cwd = process.cwd();
  console.log = (...a) => said.push(a.join(' '));
  process.chdir(app);
  void main(args); // never resolves: the server keeps running
  const isUrl = (l) => /weave dev (->|→) http/.test(l);
  for (let i = 0; i < 80 && !said.some(isUrl); i++) await new Promise((r) => setTimeout(r, 250));
  process.chdir(cwd);
  console.log = realLog;
  const line = said.find(isUrl) ?? '';
  return (line.match(/https?:[^\s]+/) ?? [])[0];
};

const browser = await chromium.launch();

/** Drive the fixture to 44, save the template as v2, wait for the reload, report what the page shows. */
const scenario = async (args) => {
  const app = mkApp();
  const url = await start(app, args);
  if (!url) {
    ok(false, `the dev server never started for ${args.join(' ')}`);
    return { count: null, version: null };
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  ok(errors.length === 0, `the page loads clean (${args.join(' ') || 'no flag'}; got ${JSON.stringify(errors)})`);
  await page.click('#b');
  await page.click('#b');
  await page.click('#b');
  ok((await page.innerText('#n')) === '44', 'three clicks get to 44');
  // The save. The page must reload — the edit has to be visible — for the number afterwards to mean anything.
  writeFileSync(join(app, 'src', 'app', 'app.html'), template('v2'));
  let version = '';
  for (let i = 0; i < 100 && version !== 'v2'; i++) {
    await page.waitForTimeout(100);
    version = await page.innerText('#v').catch(() => '');
  }
  await page.waitForTimeout(600); // the state is applied after the mount, over a fetch
  const count = await page.innerText('#n').catch(() => '');
  await page.close();
  // Removed at exit, not here: the server keeps watching the directory, and deleting it under the watcher
  // makes esbuild print resolve errors that look like failures of this test.
  process.on('exit', () => rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { count, version };
};

const kept = await scenario(['dev', '--keep-state', '--port', '0']);
ok(kept.version === 'v2', `with --keep-state the page reloaded on save (shows ${kept.version})`);
ok(kept.count === '44', `and the count survived the reload (got ${kept.count})`);

const plain = await scenario(['dev', '--port', '0']);
ok(plain.version === 'v2', `without the flag the page reloaded on save (shows ${plain.version})`);
ok(plain.count === '41', `and the count went back to the start, as before (got ${plain.count})`);

await browser.close();

if (failed) {
  console.error('\nX ' + failed + ' keep-state check(s) failed\n');
  process.exit(1);
}
console.log(NL + '+ weave dev --keep-state carries the named signals across a live reload' + NL);
process.exit(0);
