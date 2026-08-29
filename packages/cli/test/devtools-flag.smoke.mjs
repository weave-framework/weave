/**
 * `weave dev --devtools` — the reactive graph, in the page, without wiring anything.
 *
 * The panel and the introspection registry have existed in the runtime for a long time and no app ever
 * saw them: they only work if the author calls `enableDevtools()` before any named node is created and
 * then mounts the panel. So the capability was real and effectively unreachable.
 *
 * The ordering is the whole trick, and it is what this asserts by looking for a MODULE-SCOPE signal:
 * `enableDevtools` cannot be a statement in the entry, because every `import` is hoisted above it and the
 * app module would already have been evaluated with registration still off. It is its own side-effect
 * module, imported first.
 *
 * Run: `node packages/cli/test/devtools-flag.smoke.mjs` (wired into `pnpm verify:devtools-flag`).
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

console.log('\npackages/cli/test/devtools-flag.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-devtools-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-devtools-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
const NL = String.fromCharCode(10);
// The signal is created inside setup() on purpose. A module-scope one is NEVER registered - registration
// happens only when a node has an owner (`reactive.ts`) - so asserting on one would be asserting on a
// limitation, not on this feature. What this does prove is the ordering that matters: `enableDevtools`
// must run before the mount, because the mount is when setup() creates the nodes.
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  [
    'import { signal, type Signal } from "@weave-framework/runtime";',
    'export function setup(): { shared: Signal<number> } {',
    '  const shared: Signal<number> = signal(41, { name: "aNamedSignal" });',
    '  return { shared };',
    '}',
    '',
  ].join(NL)
);
writeFileSync(join(app, 'src', 'app', 'app.html'), '<main><p>{{ shared() }}</p></main>' + NL);
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
  for (let i = 0; i < 80 && !said.some((l) => l.includes('weave dev')); i++) await new Promise((r) => setTimeout(r, 250));
  process.chdir(cwd);
  console.log = realLog;
  const line = said.find((l) => l.includes('weave dev')) ?? '';
  return { url: (line.match(/https?:[^\s]+/) ?? [])[0], said };
};

const { url, said } = await start(['dev', '--devtools']);
if (!url) {
  console.error('X the dev server never printed a URL: ' + JSON.stringify(said));
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(800);

ok(errors.length === 0, 'the page loads clean (got ' + JSON.stringify(errors) + ')');
ok((await page.innerText('#app')).includes('41'), 'the app itself rendered');

const enabled = await page.evaluate(() => document.body.innerText);
ok(/aNamedSignal/.test(enabled), 'the panel lists the named signal, so enabling ran before the mount');

// And it is OFF unless asked for: an overlay nobody requested, appearing over their app, is worse than no
// feature at all — so the flag gating it is asserted rather than assumed. A second server, no flag.
const plain = await start(['dev', '--port', '0']);
if (plain.url) {
  const p2 = await browser.newPage();
  await p2.goto(plain.url, { waitUntil: 'load' });
  await p2.waitForTimeout(600);
  const text = await p2.evaluate(() => document.body.innerText);
  ok(!/Weave DevTools/.test(text), 'without the flag there is no panel (got ' + JSON.stringify(text.slice(0, 80)) + ')');
  await p2.close();
} else {
  ok(false, 'the second dev server never started');
}

await browser.close();
rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' devtools check(s) failed\n');
  process.exit(1);
}
console.log(String.fromCharCode(10) + '+ weave dev --devtools shows the reactive graph, and nothing appears without it' + String.fromCharCode(10));
process.exit(0);
