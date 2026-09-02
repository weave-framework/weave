/**
 * Node smoke for the migration service — the local HTTP surface behind `weave migrate`.
 *
 * Everything here runs against a REAL listening server over a REAL socket, because the things worth checking are
 * the ones a direct function call cannot reach: that the listener is bound to loopback only, that a cross-origin
 * page is refused, that a missing token is refused, and that a path cannot climb out of the served directory.
 *
 * Run: `node packages/migrate/test/server.smoke.mjs` (wired as `pnpm verify:migrate-server`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const fx = join(here, 'fixtures');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-server — the local migration service\n');

const out = join(repo, 'node_modules', '.weave-migrate-server-smoke.mjs');
await esbuild({
  entryPoints: [join(here, '..', 'src', 'server.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: out,
});
const { serve } = await import(pathToFileURL(out).href);

// A built UI stand-in, so the static half is exercised without waiting for the real one.
const uiDir = mkdtempSync(join(tmpdir(), 'weave-migrate-ui-'));
writeFileSync(join(uiDir, 'index.html'), '<title>stub</title>', 'utf8');

const server = await serve({ uiDir });
const api = (path, init) => fetch(`http://127.0.0.1:${server.port}${path}`, init);
const inspectBody = (p) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });

try {
  /* ── the token gates the API ── */
  const noToken = await api('/api/inspect', inspectBody(join(fx, 'multi')));
  ok(noToken.status === 403, `a request with no token is refused (got ${noToken.status})`);

  const badToken = await api(`/api/inspect?token=${'0'.repeat(48)}`, inspectBody(join(fx, 'multi')));
  ok(badToken.status === 403, `a wrong token is refused (got ${badToken.status})`);

  /* ── a page on another site cannot make this service act ── */
  const crossOrigin = await api(`/api/inspect?token=${server.token}`, {
    ...inspectBody(join(fx, 'multi')),
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
  });
  ok(crossOrigin.status === 403, `a cross-origin request is refused even WITH the token (got ${crossOrigin.status})`);

  const sameOrigin = await api(`/api/inspect?token=${server.token}`, {
    ...inspectBody(join(fx, 'multi')),
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
  });
  ok(sameOrigin.status === 200, `our own page is allowed (got ${sameOrigin.status})`);

  /* ── the answer is the same object the screen renders ── */
  const good = await api(`/api/inspect?token=${server.token}`, inspectBody(join(fx, 'multi')));
  const found = await good.json();
  ok(good.status === 200, `a good request answers 200 (got ${good.status})`);
  ok(found.units?.length === 3, `inspect returns the three units detection finds (got ${found.units?.length})`);
  ok(Array.isArray(found.signals) && found.signals.length > 0, 'the signals come with it');

  /* ── failures name what went wrong, and the path that was tried ── */
  const missing = await api(`/api/inspect?token=${server.token}`, inspectBody(join(fx, 'no-such-folder')));
  ok(missing.status === 404, `a path that does not exist answers 404 (got ${missing.status})`);
  ok((await missing.json()).error?.includes('no-such-folder'), 'the error repeats the path that was tried');

  const empty = await api(`/api/inspect?token=${server.token}`, inspectBody('   '));
  ok(empty.status === 400, `a blank path is a 400, not a crash (got ${empty.status})`);

  const notJson = await api(`/api/inspect?token=${server.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'this is not json',
  });
  ok(notJson.status === 400, `a malformed body is a 400 (got ${notJson.status})`);

  const oversized = await api(`/api/inspect?token=${server.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'x'.repeat(128 * 1024) }),
  });
  ok(oversized.status === 413, `an oversized body is refused, not buffered (got ${oversized.status})`);

  /* ── the static half, including the climb out of it ── */
  const shell = await api('/');
  ok(shell.status === 200 && (await shell.text()).includes('stub'), 'the UI shell is served at /');

  // `fetch` normalizes `/../..` away before it is sent, and `new URL` collapses `%2e%2e` too — so neither
  // reaches the server as a climb. `%2f` survives both, and becomes a separator the instant the path is
  // decoded. That is the vector worth testing; the plain form only proves the client normalizes.
  const normalized = await api('/../../../../etc/passwd');
  ok(normalized.status === 200, `a plain ../ is normalized by the client and lands on the SPA shell (got ${normalized.status})`);

  const escape = await api('/..%2f..%2f..%2f..%2fetc/passwd');
  ok(escape.status === 403, `an encoded climb out of the UI directory is refused (got ${escape.status})`);

  const badEscape = await api('/%zz');
  ok(badEscape.status === 400, `a malformed percent-escape is a 400, not a crash (got ${badEscape.status})`);

  const unknownRoute = await api(`/api/nope?token=${server.token}`);
  ok(unknownRoute.status === 404, `an unknown API route is a 404 (got ${unknownRoute.status})`);

  /* ── bound to loopback, so the network cannot reach it at all ── */
  ok(server.url.startsWith('http://127.0.0.1:'), 'the printed URL is loopback, not a hostname that could resolve outward');
  ok(server.url.includes(server.token), 'the printed URL carries the token, so opening it just works');
} finally {
  await server.close();
  rmSync(uiDir, { recursive: true, force: true });
  rmSync(out, { force: true });
}

console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
