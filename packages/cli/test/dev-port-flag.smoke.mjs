/**
 * `weave dev --port <n>` with a `weave.config.ts` present.
 *
 * The help text promised `--port <n>  Dev server port`, and the flag was read in ONE of the two `dev`
 * branches — the config-less `--serve` one. With a config, the command handed `config.port` to the
 * server and never looked at the flag, so `weave dev --port 5199` against a config saying `8000`
 * printed `http://127.0.0.1:8000` and nothing said the flag had been ignored. Reproduced on the demo
 * app before this test existed.
 *
 * The flag wins over the config, because it is the more specific statement and the one typed last.
 *
 * The first version of this test passed AGAINST the bug: it started the config server first, so the
 * config's port was taken, the flag-ignoring server stepped to the next free port, and that happened
 * to be the flag's. The flag server now starts first, on a port that is not adjacent to the config's.
 *
 * Run: `node packages/cli/test/dev-port-flag.smoke.mjs` (wired into `pnpm verify:dev-port-flag`).
 */
import { build as esbuild } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
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

console.log('\npackages/cli/test/dev-port-flag.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-dev-port-flag-bundle.mjs');
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

/** A port that is free right now: bind to 0, read what the OS gave, release it. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const configPort = await freePort();
// Not adjacent to the config's port: a server whose port is taken steps to the NEXT one, so a flag port
// of config+1 could be reached by stepping rather than by reading the flag.
let flagPort = await freePort();
while (Math.abs(flagPort - configPort) <= 1) flagPort = await freePort();
ok(configPort !== flagPort, `two distinct, non-adjacent free ports (${configPort}, ${flagPort})`);

const app = mkdtempSync(join(repo, 'tools', '.verify-dev-port-flag-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
const NL = String.fromCharCode(10);
writeFileSync(join(app, 'src', 'app', 'app.ts'), 'export function setup() {}' + NL);
writeFileSync(join(app, 'src', 'app', 'app.html'), '<main>hi</main>' + NL);
writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(
  join(app, 'weave.config.ts'),
  'import { defineConfig } from "@weave-framework/cli";' +
    NL +
    `export default defineConfig({ root: "src/app/app", index: "src/index.html", outDir: "dist", dev: { port: ${configPort} } });` +
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
  // The URL line, not the `weave dev: port … is already in use` notice that can precede it.
  const isUrl = (l) => /weave dev (->|→) http/.test(l);
  for (let i = 0; i < 80 && !said.some(isUrl); i++) await new Promise((r) => setTimeout(r, 250));
  process.chdir(cwd);
  console.log = realLog;
  const line = said.find(isUrl) ?? '';
  return (line.match(/https?:[^\s]+/) ?? [])[0];
};

const portOf = (url) => (url ? Number(new URL(url).port) : NaN);

// With the flag, the flag decides — even though the config names a port of its own. This runs FIRST,
// while the config's port is still free: a server that ignores the flag lands exactly there.
const byFlag = await start(['dev', '--port', String(flagPort)]);
ok(portOf(byFlag) === flagPort, `--port ${flagPort} wins over the config's ${configPort} (got ${byFlag})`);

// Without the flag, the config decides (this is what worked before, and must keep working).
const byConfig = await start(['dev']);
ok(portOf(byConfig) === configPort, `with no flag the config's port is used (${byConfig})`);

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' dev --port check(s) failed\n');
  process.exit(1);
}
console.log(NL + '+ weave dev --port is honoured with a config present' + NL);
process.exit(0);
