/**
 * `weave dev` on a port that is already taken.
 *
 * The server had no `error` listener, so the most ordinary situation there is — a second terminal already
 * running `weave dev` — surfaced as Node's `Unhandled 'error' event` and a raw stack trace ending in
 * EADDRINUSE. It steps to the next free port instead, and says which one it took.
 *
 * Run: `node packages/cli/test/dev-port.smoke.mjs` (wired into `pnpm verify:dev-port`).
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

console.log('\npackages/cli/test/dev-port.smoke.mjs');

const devJs = join(repo, 'tools', '.verify-dev-port-bundle.mjs');
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

/** A throwaway app with nothing interesting in it — this test is about the socket, not the bundle. */
function fixture() {
  const app = mkdtempSync(join(tmpdir(), 'weave-dev-port-'));
  writeFileSync(join(app, 'index.html'), '<!doctype html><html><body><div id="app"></div></body></html>');
  writeFileSync(join(app, 'main.ts'), "export const marker = 'PORT_TEST';\n");
  return app;
}

const a = fixture();
const b = fixture();
const PORT = 5199;

const first = await dev({ entry: join(a, 'main.ts'), servedir: a, outdir: a, index: join(a, 'index.html'), port: PORT, inMemory: true });
ok(first.url.endsWith(`:${PORT}`), `the first server takes the port it asked for (got ${first.url})`);

let second = null;
let crashed = null;
try {
  second = await dev({ entry: join(b, 'main.ts'), servedir: b, outdir: b, index: join(b, 'index.html'), port: PORT, inMemory: true });
} catch (e) {
  crashed = e;
}

ok(crashed === null, `a busy port does not crash the dev server (got ${crashed && crashed.message})`);
ok(second !== null && !second.url.endsWith(`:${PORT}`), `it moved to another port (got ${second && second.url})`);

// And the server it started is really serving — a port it reports but does not listen on would be worse
// than a crash.
if (second) {
  const res = await fetch(`${second.url}/`).catch(() => null);
  ok(res !== null && res.status === 200, `the second server actually serves on its new port (got ${res && res.status})`);
}

await first.ctx?.dispose?.();
await second?.ctx?.dispose?.();
rmSync(a, { recursive: true, force: true });
rmSync(b, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} dev-port check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ a busy port steps forward instead of crashing\n');
process.exit(0);
