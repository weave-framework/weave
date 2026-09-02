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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  /* ── the token arrives in the URL once, then lives in a cookie ──
     Without this the reader is one reload, one bookmark or one half-copied URL away from a service that
     answers 403 to everything and looks broken. */
  const firstVisit = await api(`/?token=${server.token}`);
  const setCookie = firstVisit.headers.get('set-cookie') ?? '';
  ok(setCookie.includes(server.token), 'the first visit with the token in the URL parks it in a cookie');
  ok(setCookie.includes('HttpOnly'), 'the cookie is HttpOnly, so no script can read the key back out');
  ok(setCookie.includes('SameSite=Strict'), 'SameSite=Strict, so a request started elsewhere never carries it');
  ok(!setCookie.includes('Secure'), 'no Secure flag — this is plain-http loopback, and it would stop the cookie being set');

  const wrongTokenVisit = await api('/?token=nope');
  ok(!(wrongTokenVisit.headers.get('set-cookie') ?? ''), 'a wrong token in the URL sets no cookie');

  // Node's fetch keeps no cookie jar, so the header is passed by hand — which is also clearer about what
  // is being tested: the cookie ALONE, with nothing in the URL.
  const jar = { cookie: `weave_migrate_session=${server.token}` };
  const viaCookie = await api('/api/inspect', {
    ...inspectBody(join(fx, 'multi')),
    headers: { 'content-type': 'application/json', ...jar },
  });
  ok(viaCookie.status === 200, `the cookie alone authorizes a request (got ${viaCookie.status})`);

  // `?token=` with nothing after it parses as '' — not null. With `??` the lookup would stop there and the
  // cookie would never be consulted, locking out the page that just tidied its own address bar.
  const emptyParam = await api('/api/inspect?token=', {
    ...inspectBody(join(fx, 'multi')),
    headers: { 'content-type': 'application/json', ...jar },
  });
  ok(emptyParam.status === 200, `an empty token parameter falls through to the cookie (got ${emptyParam.status})`);

  /* ── the page asks whether it is still connected; it cannot look, the cookie is HttpOnly ── */
  const sessionOk = await api('/api/session', { headers: jar });
  ok(sessionOk.status === 200, `/api/session confirms a live session (got ${sessionOk.status})`);

  const sessionDenied = await api('/api/session');
  ok(sessionDenied.status === 403, `/api/session refuses with no token and no cookie (got ${sessionDenied.status})`);

  // `dist/` is shared, so a service started before the UI was rebuilt serves the NEW page and then 404s the
  // routes it asks for. The page can only say so if the service says what it serves.
  const routes = (await sessionOk.json()).routes;
  ok(Array.isArray(routes), 'the session answer lists the routes this build serves');
  for (const r of ['/api/session', '/api/inspect', '/api/browse']) {
    ok(routes?.includes(r), `it lists ${r}`);
  }

  /* ── browsing: the picker has to be ours, because no browser will hand a server a real path ── */
  const roots = await (await api(`/api/browse?token=${server.token}`)).json();
  ok(roots.path === '', 'no path asks for the filesystem roots, and that is not an error');
  ok(roots.parent === null, 'the roots listing has no parent to go up to');
  ok(roots.entries.length > 0, `the roots listing offers somewhere to start (got ${roots.entries.length})`);
  ok(Array.isArray(roots.shortcuts) && roots.shortcuts.length > 0, 'shortcuts come with every listing');

  const inFixtures = await (await api(`/api/browse?token=${server.token}&path=${encodeURIComponent(fx)}`)).json();
  const names = inFixtures.entries.map((e) => e.name).sort();
  ok(names.includes('multi') && names.includes('npm-ws'), `the fixture folders are listed (got ${names.join(',')})`);
  ok(inFixtures.parent !== null, 'a folder below the root can go up');

  const npmWs = inFixtures.entries.find((e) => e.name === 'npm-ws');
  ok(npmWs?.markers.includes('nx.json'), `markers are visible while choosing (got ${npmWs?.markers.join(',')})`);
  ok(npmWs?.markers.includes('package.json'), 'and more than one of them');

  const pnpmWs = inFixtures.entries.find((e) => e.name === 'pnpm-ws');
  ok(pnpmWs?.markers.includes('pnpm-workspace.yaml'), 'including the pnpm marker the old detection never knew');

  // node_modules and dot-folders are never a migration target, and in a real repo they are most of a listing.
  // They cannot be committed as fixtures, so the test makes them.
  const noisy = mkdtempSync(join(tmpdir(), 'weave-migrate-noise-'));
  for (const d of ['node_modules', '.git', 'src', 'libs']) mkdirSync(join(noisy, d));
  writeFileSync(join(noisy, 'a-file.txt'), 'not a folder', 'utf8');
  const listed = await (await api(`/api/browse?token=${server.token}&path=${encodeURIComponent(noisy)}`)).json();
  const listedNames = listed.entries.map((e) => e.name).sort();
  ok(listedNames.join(',') === 'libs,src', `node_modules, dot-folders and files are all left out (got ${listedNames.join(',')})`);
  rmSync(noisy, { recursive: true, force: true });

  const nowhere = await api(`/api/browse?token=${server.token}&path=${encodeURIComponent(join(fx, 'nope'))}`);
  ok(nowhere.status === 404, `browsing a folder that is not there is a 404 (got ${nowhere.status})`);

  const browseNoToken = await api('/api/browse');
  ok(browseNoToken.status === 403, `browsing needs the token like everything else (got ${browseNoToken.status})`);

  /* ── peek: the field has to say something before Scan is pressed ── */
  const peekOk = await (await api(`/api/peek?token=${server.token}&path=${encodeURIComponent(join(fx, 'npm-ws'))}`)).json();
  ok(peekOk.exists === true && peekOk.directory === true, 'peek confirms a real folder');
  ok(peekOk.markers.includes('nx.json'), `peek reports the same markers the picker shows (got ${peekOk.markers.join(',')})`);

  const peekMissing = await (await api(`/api/peek?token=${server.token}&path=${encodeURIComponent(join(fx, 'nope'))}`)).json();
  ok(peekMissing.exists === false, 'peek says so when nothing is there, rather than erroring');

  const aFile = join(fx, 'npm-ws', 'package.json');
  const peekFile = await (await api(`/api/peek?token=${server.token}&path=${encodeURIComponent(aFile)}`)).json();
  ok(peekFile.exists === true && peekFile.directory === false, 'peek separates a file from a folder');

  const peekBlank = await api(`/api/peek?token=${server.token}&path=`);
  ok(peekBlank.status === 400, `peek with no path is a 400 (got ${peekBlank.status})`);

  ok(routes?.includes('/api/peek'), 'and it is announced in the route list');

  /* ── the analysis stream ──
     Reading a real app takes tens of seconds, so the page needs to know how far along it is. The fixture here
     is tiny, but what matters is the shape: progress events, then exactly one terminal event. */
  const streamUrl = `http://127.0.0.1:${server.port}/api/analyze-stream?token=${server.token}&path=${encodeURIComponent(join(fx, 'pnpm-ws', 'projects', 'shop'))}`;
  const streamRes = await fetch(streamUrl);
  ok(streamRes.status === 200, `the stream answers 200 (got ${streamRes.status})`);
  ok(
    (streamRes.headers.get('content-type') ?? '').startsWith('text/event-stream'),
    `and as an event stream (got ${streamRes.headers.get('content-type')})`,
  );
  const streamBody = await streamRes.text();
  const events = [...streamBody.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  ok(events.length > 0, `it emits events (got ${events.length})`);
  ok(events.filter((e) => e === 'done' || e === 'failed').length === 1, `exactly one terminal event (got ${events.join(',')})`);
  ok(events[events.length - 1] === 'done' || events[events.length - 1] === 'failed', 'and it comes last');

  const streamNoToken = await fetch(`http://127.0.0.1:${server.port}/api/analyze-stream?path=${encodeURIComponent(fx)}`);
  ok(streamNoToken.status === 403, `the stream needs the token like everything else (got ${streamNoToken.status})`);

  ok(routes?.includes('/api/analyze-stream'), 'and it is announced in the route list');

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
