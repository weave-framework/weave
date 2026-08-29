/**
 * Named app states — save the screen you are looking at, reach it again in a second.
 *
 * The claim is only worth anything if the state comes back WITHOUT the interaction that produced it,
 * so that is what this plays: the fixture is driven by clicking, saved from the panel, and then a
 * SECOND dev server is started with `--state` and asked to show the same number with nobody clicking
 * anything. The same run checks the other direction too — a plain server shows the original value —
 * because a test that only ever sees the saved number cannot tell a working state from a fixture that
 * started there.
 *
 * Run: `node packages/cli/test/dev-state.smoke.mjs` (wired into `pnpm verify:dev-state`).
 */
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

console.log('\npackages/cli/test/dev-state.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-state-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-state-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
const NL = String.fromCharCode(10);
// The signal is created inside setup(): a node is registered only when it has an owner, so a
// module-scope one would never be part of any state.
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  [
    'import { signal, type Signal } from "@weave-framework/runtime";',
    'export function setup(): { count: Signal<number>; bump: () => void } {',
    '  const count: Signal<number> = signal(41, { name: "count" });',
    '  const bump = (): void => void count.set(count() + 1);',
    '  return { count, bump };',
    '}',
    '',
  ].join(NL)
);
writeFileSync(
  join(app, 'src', 'app', 'app.html'),
  '<main><p id="n">{{ count() }}</p><button id="b" on:click={{ bump }}>+</button></main>' + NL
);
writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(
  join(app, 'weave.config.ts'),
  'import { defineConfig } from "@weave-framework/cli";' +
    NL +
    'export default defineConfig({ root: "src/app/app", index: "src/index.html", outDir: "dist" });' +
    NL
);

/** Start `weave dev` in the fixture and hand back the URL it prints. */
const start = async (args) => {
  const said = [];
  const realLog = console.log;
  const cwd = process.cwd();
  console.log = (...a) => said.push(a.join(' '));
  process.chdir(app);
  void main(args); // never resolves: the server keeps running
  for (let i = 0; i < 80 && !said.some((l) => l.includes('weave dev →')); i++) await new Promise((r) => setTimeout(r, 250));
  process.chdir(cwd);
  console.log = realLog;
  const line = said.find((l) => l.includes('weave dev →')) ?? '';
  return { url: (line.match(/https?:[^\s]+/) ?? [])[0], said };
};

const first = await start(['dev', '--devtools']);
if (!first.url) {
  console.error('X the dev server never printed a URL: ' + JSON.stringify(first.said));
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(first.url, { waitUntil: 'load' });
await page.waitForTimeout(800);
ok(errors.length === 0, 'the page loads clean (got ' + JSON.stringify(errors) + ')');
ok((await page.innerText('#n')) === '41', 'the app starts at 41');

// Drive it somewhere by hand — this is the interaction the whole feature exists to not repeat.
await page.click('#b');
await page.click('#b');
await page.click('#b');
ok((await page.innerText('#n')) === '44', 'clicking three times gets to 44');

// Save it from the panel, exactly the way a person would.
await page.click('[data-weave-devtools-tab="states"]');
await page.fill('[data-weave-devtools-state-name]', 'bumped');
await page.click('[data-weave-devtools-state-save]');
await page.waitForTimeout(600);
const saved = join(app, '.weave', 'states', 'bumped.json');
ok(existsSync(saved), 'the panel saved it to .weave/states/bumped.json');
ok(
  existsSync(saved) && JSON.stringify(JSON.parse(readFileSync(saved, 'utf8'))).includes('44'),
  'and the file holds the value that was on screen',
);

// Apply, live, with no reload: click once more so the value differs, then put the state back.
await page.click('#b');
ok((await page.innerText('#n')) === '45', 'one more click moves it off the saved value');
await page.click('[data-weave-devtools-state-apply="bumped"]');
await page.waitForTimeout(400);
ok((await page.innerText('#n')) === '44', 'Apply puts the saved state back into the running app');

// A name is validated, not sanitised — the endpoint writes files.
const bad = await page.evaluate(async () => {
  const res = await fetch('/__weave_state/..%2Fevil', { method: 'PUT', body: '{}' });
  return res.status;
});
ok(bad === 400, 'a name that is not a plain word is refused (got ' + bad + ')');
ok(!existsSync(join(app, '.weave', 'evil.json')), 'and nothing was written outside the states directory');

// The headline: a second server, started in that state, with nobody clicking anything.
const second = await start(['dev', '--state', 'bumped', '--port', '0']);
if (second.url) {
  const p2 = await browser.newPage();
  const e2 = [];
  p2.on('pageerror', (e) => e2.push(e.message));
  await p2.goto(second.url, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  ok(e2.length === 0, 'the restored page loads clean (got ' + JSON.stringify(e2) + ')');
  ok((await p2.innerText('#n')) === '44', 'and it opens at 44 without a single click');
  await p2.close();
} else {
  ok(false, 'the --state dev server never started');
}

// The control: the same fixture, same server, no flag — it must still start at 41, or the assertion
// above would pass for an app that simply began there.
const third = await start(['dev', '--port', '0']);
if (third.url) {
  const p3 = await browser.newPage();
  await p3.goto(third.url, { waitUntil: 'load' });
  await p3.waitForTimeout(600);
  ok((await p3.innerText('#n')) === '41', 'without --state the app opens where it always did');
  await p3.close();
} else {
  ok(false, 'the control dev server never started');
}

await browser.close();
rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' state check(s) failed\n');
  process.exit(1);
}
console.log(NL + '+ a named state is saved from the panel and reopened by weave dev --state' + NL);
process.exit(0);
