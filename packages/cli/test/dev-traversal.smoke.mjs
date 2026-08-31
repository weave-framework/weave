/**
 * The dev server must not serve anything outside the directory it was pointed at.
 *
 * It binds to `127.0.0.1`, which is the first and best defence — but "only reachable from this
 * machine" is not the same as "safe": a page open in the developer's browser, or anything else running
 * locally, can address it. A traversal here reads whatever the developer can read.
 *
 * The guard is `relative(servedir, target)` — the correct idiom — and this asserts it rather than
 * reading it, in the three forms the guard has to survive: a plain climb, an encoded one (a decode
 * happening in the wrong order is how these are usually reintroduced), and a Windows separator.
 *
 * The control matters as much: a real file inside the served directory must still be served, or the
 * whole thing is satisfied by a server that refuses everything.
 *
 * Run: `node packages/cli/test/dev-traversal.smoke.mjs` (wired into `pnpm verify:dev-traversal`).
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from 'node:net';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`X ${msg}`);
    failed++;
  } else console.log(`+ ${msg}`);
};

console.log('\npackages/cli/test/dev-traversal.smoke.mjs');

const devJs = join(repo, 'tools', '.verify-dev-traversal-bundle.mjs');
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

// A secret one level ABOVE the served directory — the thing a climb would be reaching for.
const root = mkdtempSync(join(tmpdir(), 'weave-traversal-'));
writeFileSync(join(root, 'SECRET.txt'), 'the-private-value\n');
const app = join(root, 'app');
rmSync(app, { recursive: true, force: true });
writeFileSync(join(root, 'placeholder'), '');
const { mkdirSync } = await import('node:fs');
mkdirSync(app, { recursive: true });
writeFileSync(join(app, 'index.html'), '<!doctype html><html><body><div id="app"></div></body></html>');
writeFileSync(join(app, 'main.ts'), "export const marker = 'TRAVERSAL_TEST';\n");
writeFileSync(join(app, 'ok.txt'), 'served\n');

const server = await dev({
  entry: join(app, 'main.ts'),
  servedir: app,
  outdir: app,
  index: join(app, 'index.html'),
  port: 5197,
  inMemory: true,
});

// A RAW request, deliberately not `fetch`: fetch resolves `../` in the URL before sending, so the
// server never sees the climb and a guard against it can never be exercised. The first version of this
// file used fetch and passed with the guard deleted — it was testing the client, not the server.
const get = (path) =>
  new Promise((resolve, reject) => {
    const url = new URL(server.url);
    const CRLF = String.fromCharCode(13, 10);
    const socket = connect({ host: url.hostname, port: Number(url.port) }, () => {
      socket.write(
        [`GET ${path} HTTP/1.1`, `Host: ${url.host}`, 'Connection: close', '', ''].join(CRLF)
      );
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (c) => (raw += c));
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number(/^HTTP\/1\.\d (\d+)/.exec(raw)?.[1] ?? 0);
      const sep = CRLF + CRLF;
      resolve({ status, body: raw.slice(raw.indexOf(sep) + sep.length) });
    });
  });

// The control: an ordinary file inside the served root is served, so a refusal below means something.
const good = await get('/ok.txt');
ok(good.status === 200 && good.body.includes('served'), `a file inside the served root is served (${good.status})`);

for (const [what, path] of [
  ['a plain climb', '/../SECRET.txt'],
  ['an encoded climb', '/..%2fSECRET.txt'],
  ['a doubly encoded climb', '/..%252fSECRET.txt'],
  ['a backslash climb', '/..\\SECRET.txt'],
  ['a deep climb', '/../../../../../../etc/passwd'],
]) {
  const r = await get(path);
  // Not just "the secret is absent": a 200 has to BE the SPA shell, or this passes for a body that
  // happens not to contain the string it was looking for.
  const refused = r.status === 403 || r.status === 404;
  const shell = r.status === 200 && r.body.includes('id="app"');
  ok(
    !r.body.includes('the-private-value') && (refused || shell),
    `${what} is refused or falls back to the shell — never a file above (status ${r.status})`
  );
}

server.ctx?.dispose?.();
// Best effort: on Windows the server can still hold a handle, and a cleanup failure is not a finding.
try {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
} catch {
  console.log('  (temp directory left behind — the OS still held it)');
}

console.log('\n----------------------------------------');
if (failed) {
  console.error(`dev-traversal smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('dev-traversal smoke passed\n');
process.exit(0);
