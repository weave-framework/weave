/**
 * `weave dev` — a proxied long-lived stream must not be able to kill the dev server.
 *
 * The proxy's `error` handler wrote a 502 unconditionally. For an ordinary request that is right:
 * the upstream was unreachable, nothing has been sent, a 502 is the answer. For an SSE stream it is
 * fatal — the head went out the moment the backend responded, so when the upstream socket later
 * drops (which is the NORMAL end of a long-lived stream, not an exception) the handler calls
 * `res.writeHead` a second time, Node throws ERR_HTTP_HEADERS_SENT from inside an event handler,
 * and the unhandled throw takes the whole dev server down. The developer loses the UI server
 * because a notification stream reconnected.
 *
 * Found in a real consumer, which had worked around it by bypassing the proxy for SSE entirely —
 * so the proxied configuration stopped being exercised at all.
 *
 * This drives the real `dev()` against a real upstream that answers, streams, then RESETS the
 * socket mid-stream, and asserts nothing throws into the dev server.
 *
 * Two things this test cannot do, recorded so they are not mistaken for coverage:
 *  - it installs an `uncaughtException` handler, so it OBSERVES the throw rather than dying of it.
 *    In a real `weave dev` there is no such handler and the process exits — the check below reads
 *    "did not throw", and process death is the consequence, not the assertion.
 *  - the reset must be an RST, not a clean FIN. Built with `socket.destroy()` this test passed
 *    against the unfixed proxy: a clean close ends the piped response with no error event at all,
 *    so the error path never ran. It was vacuous for one run before that was caught.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, get } from 'node:http';

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

/** An upstream that sends headers + one chunk, then destroys the socket mid-stream. */
function startFlakyUpstream() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url.startsWith('/api/stream')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('data: {"kind":"ping"}\n\n');
        // The upstream dies with the head already out — exactly what an SSE reconnect looks like.
        // It must be an RST (`resetAndDestroy`), not a plain `destroy()`: a clean FIN ends the
        // piped response without any error event, so the proxy's error path never runs and a test
        // built on it would pass against the bug. ECONNRESET is what a dropped stream really is.
        setTimeout(() => res.socket.resetAndDestroy(), 30);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Bounded on purpose. A dev server killed by the bug under test stops answering rather than
 * refusing, so an unbounded request would HANG the suite instead of failing it — the check would
 * never go red, which is the same as not having it.
 */
const fetchText = (url) =>
  new Promise((resolve) => {
    const req = get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ status: 0, body: '' });
    });
  });

/**
 * Open the stream and wait for it to end however it ends — we only care that we survive it.
 * Bounded for the same reason as `fetchText`: with the bug present the response never ends, so
 * an unbounded wait hangs the suite forever instead of letting the checks below report.
 */
const drain = (url) =>
  new Promise((resolve) => {
    const req = get(url, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve('end'));
      res.on('error', () => resolve('error'));
    });
    req.on('error', () => resolve('error'));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve('timeout');
    });
  });

console.log('\npackages/cli/test/dev-proxy-stream.smoke.mjs');

// Same recipe as dev-overlay.smoke.mjs: bundle dev.ts inside the repo so Node resolves the
// external `esbuild` from node_modules.
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

const app = mkdtempSync(join(tmpdir(), 'weave-dev-proxy-'));
const entry = join(app, 'main.ts');
writeFileSync(join(app, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(entry, "export const marker = 'ok';\n");

const { server: upstream, port: upstreamPort } = await startFlakyUpstream();

let devServer;
let crashed = null;
const onFatal = (e) => {
  crashed = e;
};
process.on('uncaughtException', onFatal);

try {
  devServer = await dev({
    entry,
    servedir: app,
    outdir: app,
    index: join(app, 'index.html'),
    inMemory: true,
    proxy: { '/api': `http://127.0.0.1:${upstreamPort}` },
  });
  const base = devServer.url;

  const before = await fetchText(`${base}/api/health`);
  ok(before.status === 200, 'proxy forwards an ordinary request');

  await drain(`${base}/api/stream`);
  await new Promise((r) => setTimeout(r, 150)); // let any late error handler run

  ok(crashed === null, `a dropped upstream stream does not throw into the dev server (${crashed?.message ?? 'clean'})`);

  const after = await fetchText(`${base}/api/health`);
  ok(after.status === 200, 'the dev server is STILL serving after the stream dropped');
} finally {
  process.off('uncaughtException', onFatal);
  await devServer?.ctx?.dispose();
  upstream.close();
  rmSync(app, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\ndev proxy stream: OK');
process.exit(0); // the dev server / esbuild watch keep the loop alive; we're done.
