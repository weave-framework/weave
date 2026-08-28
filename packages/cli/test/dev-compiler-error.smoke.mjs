/**
 * `weave dev` — a COMPILER error must behave like a syntax error: report it, then recover.
 *
 * `dev-overlay.smoke.mjs` covers the error esbuild raises itself (invalid TypeScript). This one covers
 * the errors the *Weave plugin* raises from inside its `onLoad` callback. Those used to be re-thrown
 * (`plugin.ts` converted only `ParseError` into a located esbuild error and let everything else escape),
 * and an exception thrown out of a plugin callback takes esbuild's watch state with it: the server kept
 * serving the last good bundle FOREVER — every later save was ignored, with no message anywhere. The
 * developer saw "my edits do nothing" and the only cure was restarting the dev server.
 *
 * Two of those throws are exercised here, both reachable by an ordinary typo:
 *   1. an empty template file (an editor truncating on save is enough), and
 *   2. a component tag with no import and no module to auto-resolve.
 *
 * The assertion that matters is the LAST one of each pair: after the error is repaired, the next save
 * must reach the browser.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { get } from 'node:http';

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

console.log('\npackages/cli/test/dev-compiler-error.smoke.mjs');

const devJs = join(repo, 'tools', '.verify-dev-compiler-error-bundle.mjs');
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

// The fixture app lives INSIDE the repo: its component imports `@weave-framework/runtime`, which only
// resolves from a directory under the workspace. In the OS temp dir every build fails on the import
// instead of on the thing under test.
const app = mkdtempSync(join(repo, 'tools', '.verify-dev-compiler-app-'));
const entry = join(app, 'main.ts');
const componentTs = join(app, 'app.ts');
const componentHtml = join(app, 'app.html');

writeFileSync(join(app, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(componentTs, "import { signal } from '@weave-framework/runtime';\nexport function setup() {\n  const count = signal(0);\n  return { count };\n}\n");
writeFileSync(componentHtml, '<p>FIRST_GOOD_BUILD {{ count() }}</p>\n');
writeFileSync(entry, "import App from './app';\nexport const root = App;\n");

const server = await dev({ entry, servedir: app, outdir: app, index: join(app, 'index.html'), inMemory: true });

const fetchText = async (path) => {
  const r = await fetch(`${server.url}${path}`).catch(() => null);
  return r ? { status: r.status, body: await r.text() } : { status: 0, body: '' };
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  const r = await fetchText('/main.js');
  if (r.status === 200) break;
  await settle(100);
}

const events = [];
const sse = get(`${server.url}/__weave_reload`, (res) => {
  res.on('data', (c) => events.push(String(c)));
});
await settle(300);

const first = await fetchText('/main.js');
ok(first.status === 200 && first.body.includes('FIRST_GOOD_BUILD'), 'the clean build is served');

/** The marker the last SUCCESSFUL build carried — what a failed rebuild must keep serving. */
let lastGood = 'FIRST_GOOD_BUILD';

/** Break the template, wait, then repair it with a marker the next build must carry. */
async function breakAndRepair(label, brokenTemplate, marker) {
  events.length = 0;
  writeFileSync(componentHtml, brokenTemplate);
  await settle(1800);

  const broken = await fetchText('/main.js');
  ok(broken.body.includes(lastGood), `${label}: the last good bundle survives the failure`);
  ok(
    events.some((e) => e.includes('data: error:')),
    `${label}: the failure is pushed to the browser as an error (got: ${JSON.stringify(events)})`
  );

  events.length = 0;
  writeFileSync(componentHtml, `<p>${marker} {{ count() }}</p>\n`);
  await settle(1800);

  const repaired = await fetchText('/main.js');
  ok(repaired.body.includes(marker), `${label}: the REPAIRED build reaches the browser (watch survived the error)`);
  if (repaired.body.includes(marker)) lastGood = marker;
}

// 1. An empty template file — the compiler throws `Empty template fragment`.
await breakAndRepair('empty template', '', 'REPAIRED_AFTER_EMPTY');

// 2. A component tag that resolves to nothing — the plugin throws from `injectChildImports`.
await breakAndRepair('unresolved child component', '<p><NoSuchChild /></p>\n', 'REPAIRED_AFTER_MISSING_CHILD');

// The error text the browser is shown must name the author's file, not a path inside node_modules.
events.length = 0;
writeFileSync(componentHtml, '');
await settle(1800);
const errorText = decodeURIComponent(events.join('').replace(/^data: error:/, '').trim());
// Guard the two assertions below against passing on an empty string: a wedged server pushes nothing,
// and "no text" would otherwise read as "no node_modules path".
ok(errorText.length > 0, `the browser is told what broke (got: ${JSON.stringify(errorText)})`);
ok(errorText.length > 0 && !/node_modules/.test(errorText), `the reported error does not point into node_modules (got: ${errorText.slice(0, 200)})`);
ok(/app\.html/.test(errorText), `the reported error names the template file (got: ${errorText.slice(0, 200)})`);

sse.destroy();
await server.ctx?.dispose?.();
await server.stop?.();
rmSync(app, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} dev compiler-error check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a compiler error reports itself and the dev loop keeps working\n');
process.exit(0);
