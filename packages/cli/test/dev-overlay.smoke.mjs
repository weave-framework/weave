/**
 * `weave dev` — a FAILED rebuild must not reload the browser.
 *
 * The dev server used to clear its in-memory outputs, repopulate them from `result.outputFiles` (empty on a
 * failed build) and then notify every client unconditionally. So a syntax error — the most common event in
 * a dev loop — reloaded the page into a `/main.js` that no longer existed: a white screen, with the real
 * error visible only in the terminal the developer had just navigated away from. The tool erased the
 * evidence at exactly the moment it mattered.
 *
 * This drives the real `dev()` against a real fixture: build clean, break the source, and assert that the
 * previously served bundle is STILL served and that the client is told `error:` rather than `reload`.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

console.log('\npackages/cli/test/dev-overlay.smoke.mjs');

// The bundle must live inside the repo so Node resolves the external `esbuild` from node_modules.
const devJs = join(repo, 'tools', '.verify-dev-overlay-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/dev.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: devJs,
  external: ['esbuild', 'typescript'],
});
const { dev } = await import(pathToFileURL(devJs).href);
process.on('exit', () => rmSync(devJs, { force: true }));

const app = mkdtempSync(join(tmpdir(), 'weave-dev-overlay-'));
const entry = join(app, 'main.ts');
writeFileSync(join(app, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(entry, "export const marker = 'FIRST_GOOD_BUILD';\n");

const server = await dev({ entry, servedir: app, outdir: app, index: join(app, 'index.html'), inMemory: true });

const fetchText = async (path) => {
  const r = await fetch(`${server.url}${path}`).catch(() => null);
  return r ? { status: r.status, body: await r.text() } : { status: 0, body: '' };
};

// The build runs asynchronously after watch(); poll until the first bundle lands.
for (let i = 0; i < 60; i++) {
  const r = await fetchText('/main.js');
  if (r.status === 200) break;
  await new Promise((res) => setTimeout(res, 100));
}

// Hold an SSE connection open and collect what the server pushes.
const events = [];
const sse = get(`${server.url}/__weave_reload`, (res) => {
  res.on('data', (c) => events.push(String(c)));
});

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
await settle(300);

const first = await fetchText('/main.js');
ok(first.status === 200 && first.body.includes('FIRST_GOOD_BUILD'), 'the clean build is served');

// The injected client must be able to tell the two messages apart.
const shell = await fetchText('/');
ok(shell.body.includes('__weave_error'), 'the dev shell injects an error-overlay client');

// Now break it.
events.length = 0;
writeFileSync(entry, "export const marker = 'BROKEN' this is not valid typescript(((\n");
await settle(1500);

const after = await fetchText('/main.js');
ok(after.status === 200 && after.body.includes('FIRST_GOOD_BUILD'), 'a failed rebuild keeps serving the last good bundle');
ok(
  events.some((e) => e.includes('data: error:')),
  `a failed rebuild pushes an error, not a reload (got: ${JSON.stringify(events)})`
);
ok(!events.some((e) => e.includes('data: reload')), 'a failed rebuild does NOT tell the browser to reload');

// Repair it: the next good build must swap the bundle and reload (clearing the overlay).
events.length = 0;
writeFileSync(entry, "export const marker = 'SECOND_GOOD_BUILD';\n");
await settle(1500);

const repaired = await fetchText('/main.js');
ok(repaired.body.includes('SECOND_GOOD_BUILD'), 'a repaired build replaces the served bundle');
ok(
  events.some((e) => e.includes('data: reload')),
  `a repaired build reloads the browser (got: ${JSON.stringify(events)})`
);

sse.destroy();
await server.stop?.();
rmSync(app, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} dev-overlay check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a failed rebuild keeps the page alive and reports the error\n');
process.exit(0);
