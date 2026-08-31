/**
 * A build must not be silent about what it did not check.
 *
 * `weave check` is the gate and `weave build` does not run it, so a build succeeds on code the checker
 * refuses — a template calling a name `setup` never returns bundles cleanly and throws in the browser.
 * Nothing in the output said so, which is the part that matters: the author had no way to know the
 * build's silence was not a verdict.
 *
 * Two halves, and the default deliberately does not change:
 *   1. `weave build` still builds, and now SAYS it did not type-check. Making the check mandatory would
 *      turn a green pipeline red on unchanged code, which is a decision for a major, not a default.
 *   2. `weave build --check` runs the checker FIRST and refuses to emit anything if it finds errors —
 *      no artifact from code known to be broken.
 *
 * Run: `node packages/cli/test/build-check.smoke.mjs` (wired into `pnpm verify:build-check`).
 */
import { build as esbuild } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtAssets } from '../../../tools/built-assets.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/build-check.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-build-check-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-build-check-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
writeFileSync(
  join(app, 'weave.config.ts'),
  "import { defineConfig } from '@weave-framework/cli';\n\nexport default defineConfig({ root: 'src/app/app', index: 'index.html', outDir: 'dist' });\n"
);
writeFileSync(join(app, 'index.html'), '<!doctype html><html><body><div id="app"></div></body></html>\n');
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  'export function setup(): { count: number } {\n  const count = 1;\n  return { count };\n}\n'
);

const broken = '<div>{{ missingName() }}</div>\n';
const sound = '<div>{{ count }}</div>\n';
const template = (text) => writeFileSync(join(app, 'src', 'app', 'app.html'), text);

/** Run the CLI in the fixture, capturing what it printed and whether it exited. */
const run = async (args) => {
  const said = [];
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const cwd = process.cwd();
  let exited = null;
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  process.exit = (code) => {
    exited = code ?? 0;
    throw new Error('__exit__');
  };
  process.chdir(app);
  try {
    await main(args);
  } catch (e) {
    if (!String(e && e.message).includes('__exit__')) said.push(String(e?.message ?? e));
  } finally {
    process.chdir(cwd);
    console.log = realLog;
    console.error = realErr;
    process.exit = realExit;
  }
  return { said: said.join('\n'), exited };
};

/* ── 1. The default builds, and says what it did not do ── */
template(broken);
rmSync(join(app, 'dist'), { recursive: true, force: true });
const plain = await run(['build']);
ok(plain.exited === null, 'a plain build still succeeds on code the checker refuses');
ok(existsSync(join(app, 'dist', builtAssets(join(app, 'dist')).script)), 'and still writes its bundle');
ok(
  /not type-checked/i.test(plain.said),
  'but it SAYS it was not type-checked: ' + JSON.stringify(plain.said.slice(-160))
);

/* ── 2. `--check` refuses, and emits nothing ── */
rmSync(join(app, 'dist'), { recursive: true, force: true });
const checked = await run(['build', '--check']);
ok(checked.exited === 1, 'build --check fails on the same code (exit ' + checked.exited + ')');
ok(/missingName/.test(checked.said), 'and names what is wrong: ' + JSON.stringify(checked.said.slice(0, 160)));
ok(
  !existsSync(join(app, 'dist', builtAssets(join(app, 'dist')).script)),
  'and writes NO bundle — an artifact from code known to be broken is worse than none'
);

/* ── 3. …while a sound app is unaffected ── */
template(sound);
rmSync(join(app, 'dist'), { recursive: true, force: true });
const good = await run(['build', '--check']);
ok(good.exited === null, 'build --check passes a sound app (' + JSON.stringify(good.said.slice(-120)) + ')');
ok(existsSync(join(app, 'dist', builtAssets(join(app, 'dist')).script)), 'and it writes its bundle');
ok(!/not type-checked/i.test(good.said), 'and it does not claim to be unchecked, because it was');

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' build-check check(s) failed\n');
  process.exit(1);
}
console.log('\n+ the build says what it checked, and --check refuses to emit broken code\n');
process.exit(0);
