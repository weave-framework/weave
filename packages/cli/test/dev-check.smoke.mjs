/**
 * `weave dev` type-checks after every successful rebuild, and the page shows the result.
 *
 * The single most common first mistake — `{{ count }}` for `{{ count() }}` — renders the signal's source
 * text into the page and throws nothing. `weave check` names it precisely ("a signal is read with `()`"),
 * but it is a separate command, and a newcomer does not know it exists. The dev loop is where they are, so
 * the dev loop now runs the checker — in a worker, after the reload has gone out, so the page never waits
 * on it — and pushes what it found over the same live-reload channel as a `check:` message. Fixing the
 * file pushes an empty `check:`, which clears the panel.
 *
 * Pinned here:
 *  - a template mistake arrives as a `check:` message that carries the checker's own sentence;
 *  - a client that connects while errors stand is told at once (the page reloads BEFORE the check lands,
 *    so the fresh page's connection is the one that has to hear it);
 *  - repairing the file clears it;
 *  - the shell carries the panel client.
 *
 * Run: `node packages/cli/test/dev-check.smoke.mjs` (wired into `pnpm verify:dev-check`).
 */
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { get } from 'node:http';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/dev-check.smoke.mjs');

// Inside the repo: the worker re-imports this bundle, and the fixture's `@weave-framework/runtime` types
// have to resolve from where the fixture sits.
const devJs = join(repo, 'tools', '.verify-dev-check-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-dev-check-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
const NL = String.fromCharCode(10);
const tpl = join(app, 'src', 'app', 'app.html');
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  ["import { signal } from '@weave-framework/runtime';", 'export function setup() {', '  const count = signal(0);', '  const inc = () => count.set((n) => n + 1);', '}', ''].join(NL)
);
// The mistake: the signal is not called.
writeFileSync(tpl, '<button on:click={{ inc }}>clicked {{ count }} times</button>' + NL);
writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
const entry = join(app, 'src', 'main.ts');
writeFileSync(
  entry,
  ["import { mountComponent } from '@weave-framework/runtime/dom';", "import App from './app/app';", "mountComponent(App, '#app');", ''].join(NL)
);

const server = await dev({
  entry,
  servedir: app,
  outdir: app,
  index: join(app, 'src', 'index.html'),
  inMemory: true,
  check: { roots: [join(app, 'src')] },
});

const fetchText = async (path) => {
  const r = await fetch(`${server.url}${path}`).catch(() => null);
  return r ? { status: r.status, body: await r.text() } : { status: 0, body: '' };
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open an SSE connection and collect every `check:` payload it receives, decoded. */
const listen = () => {
  const checks = [];
  const req = get(`${server.url}/__weave_reload`, (res) => {
    res.on('data', (c) => {
      for (const m of String(c).matchAll(/data: check:([^\n]*)/g)) checks.push(decodeURIComponent(m[1]));
    });
  });
  return { checks, close: () => req.destroy() };
};
/** Wait until `pred(checks)` holds, or give up after `ms`. */
const until = async (checks, pred, ms) => {
  for (let i = 0; i < ms / 100; i++) {
    if (pred(checks)) return true;
    await settle(100);
  }
  return pred(checks);
};

// The build runs asynchronously after watch(); poll until the first bundle lands.
for (let i = 0; i < 60; i++) {
  if ((await fetchText('/main.js')).status === 200) break;
  await settle(100);
}

const shell = await fetchText('/');
ok(shell.body.includes('__weave_check'), 'the dev shell injects the check-panel client');

/* ── 1. the mistake is reported, in the checker's own words ── */
const first = listen();
ok(await until(first.checks, (c) => c.some((t) => t.includes('TS2345')), 30000), `a check: message arrives for the uncalled signal (got ${JSON.stringify(first.checks)})`);
const report = first.checks.find((t) => t.includes('TS2345')) ?? '';
ok(/a signal is read with `\(\)`/.test(report), 'it carries the checker\'s sentence, not a bare code');
ok(/app\.html:1:\d+/.test(report), 'it points at the template line');
first.close();

/* ── 2. a client connecting while errors stand hears them at once ── */
const late = listen();
ok(await until(late.checks, (c) => c.some((t) => t.includes('TS2345')), 3000), 'a freshly connected client is handed the standing result');
late.close();

/* ── 3. repairing the file clears it ── */
const after = listen();
await settle(300);
after.checks.length = 0;
writeFileSync(tpl, '<button on:click={{ inc }}>clicked {{ count() }} times</button>' + NL);
ok(await until(after.checks, (c) => c.some((t) => t === ''), 30000), `the repaired file pushes an empty check: (got ${JSON.stringify(after.checks)})`);
after.close();

/* ── 4. and a client connecting now hears nothing (no stale result) ── */
const clean = listen();
await settle(500);
ok(clean.checks.length === 0, `a client connecting after the repair is not told about old errors (got ${JSON.stringify(clean.checks)})`);
clean.close();

await server.stop?.();
rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error(`\nX ${failed} dev-check assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n+ weave dev type-checks after each rebuild and the page hears about it\n');
process.exit(0);
