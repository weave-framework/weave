/**
 * Smoke test for `weave dev`'s `dev.proxy` (packages/cli/src/dev.ts).
 *
 * Boots the REAL in-memory dev server with a proxy table pointing at a throwaway backend,
 * then asserts the contract:
 *   1. GET  /api/health   → forwarded, path preserved, backend body returned.
 *   2. POST /api/echo     → request body + `Cookie` forwarded; backend `Set-Cookie` returned.
 *   3. GET  /             → the app shell (NOT proxied — no `/api` match).
 *   4. GET  /main.js      → the in-memory build (NOT proxied).
 *   5. rewrite `^/api` → '' strips the prefix (path rewrite, query preserved).
 *
 * DoD: assertions 1/2/5 FAIL if the proxy block is removed from handleRequest (the requests
 * fall through to the SPA shell), so this test fails without the feature.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

// 1. Bundle dev.ts so this Node script can call the real dev(). `esbuild` stays external, so the
// bundle must sit INSIDE the repo for Node to resolve `esbuild` from node_modules (a tmp dir can't).
const devJs = join(repo, 'tools', '.verify-dev-proxy-bundle.mjs');
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

// 2. A throwaway backend the proxy will forward to.
const backend = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sid=xyz; HttpOnly' });
      res.end(`echo:${body}:cookie:${req.headers.cookie ?? ''}`);
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`health:${req.url}`);
    }
  });
});
const backendPort = await new Promise((r) => backend.listen(0, '127.0.0.1', () => r(backend.address().port)));

// 3. A minimal Weave app fixture (a shell + a `main.ts` entry → the build output is `/main.js`).
const app = mkdtempSync(join(tmpdir(), 'weave-dev-proxy-app-'));
writeFileSync(join(app, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(join(app, 'main.ts'), "document.title = 'dev-proxy-fixture';\n");

// 4. Boot the dev server with a proxy table (shorthand + a rewrite rule).
const server = await dev({
  entry: join(app, 'main.ts'),
  servedir: app,
  outdir: app,
  index: join(app, 'index.html'),
  inMemory: true,
  proxy: {
    '/api': `http://127.0.0.1:${backendPort}`,
    '/svc': { target: `http://127.0.0.1:${backendPort}`, rewrite: { '^/svc': '/api' } },
  },
});
// The build runs asynchronously after watch(); poll until /main.js lands in the outputs map.
for (let i = 0; i < 50; i++) {
  const r = await fetch(`${server.url}/main.js`).catch(() => null);
  if (r && r.status === 200) break;
  await new Promise((res) => setTimeout(res, 100));
}

try {
  // 1. GET /api/health → forwarded, path preserved.
  const health = await fetch(`${server.url}/api/health`);
  ok((await health.text()) === 'health:/api/health', 'GET /api/health is forwarded with the path preserved');

  // 2. POST /api/echo → body + cookie forwarded; Set-Cookie returned.
  const echo = await fetch(`${server.url}/api/echo`, {
    method: 'POST',
    headers: { cookie: 'sid=abc' },
    body: 'ping',
  });
  const echoText = await echo.text();
  ok(echoText === 'echo:ping:cookie:sid=abc', 'POST forwards the request body and Cookie header');
  ok((echo.headers.get('set-cookie') ?? '').includes('sid=xyz'), 'the backend Set-Cookie reaches the client');

  // 5. rewrite: /svc/health → backend /api/health (^/svc → /api), query preserved.
  const rew = await fetch(`${server.url}/svc/health?q=1`);
  ok((await rew.text()) === 'health:/api/health?q=1', 'rewrite rewrites the path and preserves the query');

  // 3. GET / → the app shell (not proxied).
  const shell = await fetch(`${server.url}/`);
  ok((await shell.text()).includes('<div id="app">'), 'GET / still serves the app shell (not proxied)');

  // 4. GET /main.js → the in-memory build (not proxied).
  const mainJs = await fetch(`${server.url}/main.js`);
  ok(
    mainJs.status === 200 && (mainJs.headers.get('content-type') ?? '').includes('javascript'),
    'GET /main.js still serves the in-memory build (not proxied)'
  );

  // 6. backend down → 502, dev server survives.
  const server2 = await dev({
    entry: join(app, 'main.ts'),
    servedir: app,
    outdir: app,
    index: join(app, 'index.html'),
    inMemory: true,
    proxy: { '/api': 'http://127.0.0.1:1' }, // nothing listens on port 1
  });
  const down = await fetch(`${server2.url}/api/x`);
  ok(down.status === 502, 'an unreachable backend responds 502 (no crash)');
  await server2.ctx.dispose();
} finally {
  await server.ctx.dispose();
  backend.close();
}

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ weave dev proxy verified (forward + cookies + rewrite + non-proxied paths + 502).');
// esbuild's watch context keeps the event loop alive even after dispose(); exit explicitly.
process.exit(0);
