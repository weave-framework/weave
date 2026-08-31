/**
 * Two config-surface proofs, both found by building a real package against Weave 2.1.0.
 *
 * 1. A component LIBRARY may declare a config. It has no app entry — it exists to declare
 *    `styleLang`, which the loader needs (it pairs a component with `<base>.<styleLang>` and
 *    does NOT probe) and which nothing else can supply. `resolveConfig` used to reject that
 *    outright: "config must declare either `root` … or `entry`", so `weave check` failed on a
 *    library and there was nowhere supported to put the value. The requirement belongs to
 *    `build`/`dev`, which is where it must still be reported — framed, not as an esbuild crash.
 *
 * 2. `publicDir` defaults to the config's OWN directory, and `outDir` defaults to `dist` inside
 *    it — so the copy step handed Node's `cp` a directory and a destination inside it, which it
 *    refuses up front: `EINVAL … cannot copy <app> to a subdirectory of self`. An app that
 *    simply omits `publicDir` — the documented default — failed its first `weave build` with
 *    what reads like a filesystem fault. And the naive fix is worse than the bug: copying an
 *    undeclared project directory into `dist/` ships `src/`, `node_modules/` and `.env`.
 */
import { build as esbuild } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtAssets } from '../../../tools/built-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

// ── Bundle config.ts into one temp module (inside the repo, so esbuild/sass resolve) ──
const modDir = mkdtempSync(join(repo, 'packages', 'cli', 'test', '.smoke-'));
const entry = join(modDir, 'entry.ts');
writeFileSync(
  entry,
  `export { loadConfig } from ${JSON.stringify(join(repo, 'packages/cli/src/config.ts').replace(/\\/g, '/'))};\n`
);
const outMod = join(modDir, 'cli.mjs');
await esbuild({
  entryPoints: [entry],
  outfile: outMod,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['esbuild', 'sass', 'typescript'],
});
const { loadConfig } = await import(pathToFileURL(outMod).href);

// The fixture apps live INSIDE the repo: they import `@weave-framework/runtime`, which only
// resolves from a directory under a tree that has the workspace's node_modules above it.
const fix = mkdtempSync(join(repo, 'packages', 'cli', 'test', '.smoke-app-'));

/* ── 1. A library config (no root, no entry) loads ── */
{
  const dir = join(fix, 'lib');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'weave.config.ts'), `export default { styleLang: 'scss' };\n`);

  let config = null;
  let error = null;
  try {
    config = await loadConfig(dir);
  } catch (e) {
    error = e;
  }
  ok(error === null, `a config with neither \`root\` nor \`entry\` loads${error ? ` — got: ${error.message}` : ''}`);
  ok(config?.styleLang === 'scss', 'the library gets its styleLang through the config');
  ok(config?.entry === undefined && config?.rootComponent === undefined, 'no app entry is invented for it');

  // …and `weave check` runs there (it type-checks sources; it needs no entry).
  const check = spawnSync(process.execPath, [join(repo, 'packages/cli/bin/weave.mjs'), 'check', 'src'], {
    cwd: dir,
    encoding: 'utf8',
  });
  ok(check.status === 0, `\`weave check\` succeeds in a library${check.status ? ` — ${check.stderr.trim()}` : ''}`);

  // …but `weave build` there must say so plainly, naming both fields.
  mkdirSync(join(dir, 'src'), { recursive: true });
  const built = spawnSync(process.execPath, [join(repo, 'packages/cli/bin/weave.mjs'), 'build'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const out = built.stdout + built.stderr;
  ok(built.status === 1, '`weave build` fails on a library config');
  ok(/`root`/.test(out) && /`entry`/.test(out), 'and the message names both `root` and `entry`');
  ok(!/esbuild|ENOENT|undefined/i.test(out), `and it is a framed diagnostic, not a crash — got: ${out.trim()}`);
}

/* ── 2. `weave build` with the DEFAULT publicDir ── */
// Driven through the real `weave build`, not by calling build() with hand-chosen arguments:
// the whole point is what the CLI derives from a config that says nothing about `publicDir`.

/** A minimal buildable app. `publicDir` is written into the config only when given. */
function appAt(name, outSpec, publicDir) {
  const dir = join(fix, name);
  mkdirSync(join(dir, 'src', 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app', 'app.ts'),
    `export const template = '<h1>hi</h1>';\nexport function setup() { return {}; }\n`
  );
  writeFileSync(join(dir, 'src', 'index.html'), '<!doctype html><html><body><div id="app"></div></body></html>');
  writeFileSync(
    join(dir, 'weave.config.ts'),
    `export default {\n` +
      `  root: 'src/app/app',\n` +
      `  index: 'src/index.html',\n` +
      `  outDir: ${JSON.stringify(outSpec)},\n` +
      (publicDir ? `  publicDir: ${JSON.stringify(publicDir)},\n` : '') +
      `};\n`
  );
  // What a project directory holds that must never reach a deployable dist.
  writeFileSync(join(dir, '.env'), 'SECRET=hunter2\n');
  return { dir, outDir: join(dir, ...outSpec.split('/')) };
}

const runBuild = (dir) =>
  spawnSync(process.execPath, [join(repo, 'packages/cli/bin/weave.mjs'), 'build'], { cwd: dir, encoding: 'utf8' });

for (const outSpec of ['dist', 'build/dist']) {
  const { dir, outDir } = appAt(`app-${outSpec.replace('/', '-')}`, outSpec);
  const run = runBuild(dir);
  ok(run.status === 0, `[outDir: ${outSpec}] \`weave build\` with the default publicDir succeeds — ${(run.stdout + run.stderr).trim()}`);
  ok(existsSync(join(outDir, 'index.html')), `[outDir: ${outSpec}] the shell is written`);
  ok(existsSync(join(outDir, builtAssets(outDir).script)), `[outDir: ${outSpec}] the bundle is written`);
  ok(!existsSync(join(outDir, '.env')), `[outDir: ${outSpec}] the project's .env is NOT shipped`);
  ok(!existsSync(join(outDir, 'weave.config.ts')), `[outDir: ${outSpec}] the config is NOT shipped`);
  ok(!existsSync(join(outDir, 'src')), `[outDir: ${outSpec}] the sources are NOT shipped`);
}

/* ── 2b. A DECLARED publicDir containing the output still copies — minus the output ── */
for (const outSpec of ['public/dist', 'public/build/dist']) {
  const { dir, outDir } = appAt(`declared-${outSpec.replace(/\//g, '-')}`, outSpec, 'public');
  mkdirSync(join(dir, 'public', 'icons'), { recursive: true });
  writeFileSync(join(dir, 'public', 'favicon.ico'), 'icon');
  writeFileSync(join(dir, 'public', 'icons', 'logo.svg'), '<svg/>');

  const run = runBuild(dir);
  ok(run.status === 0, `[publicDir holds outDir: ${outSpec}] the build succeeds — ${(run.stdout + run.stderr).trim()}`);
  ok(existsSync(join(outDir, 'favicon.ico')), `[${outSpec}] the declared static root IS copied`);
  ok(existsSync(join(outDir, 'icons', 'logo.svg')), `[${outSpec}] including its subdirectories`);
  // The output dir must not appear inside itself at any depth.
  const nested = join(outDir, ...outSpec.split('/').slice(1));
  ok(!existsSync(nested), `[${outSpec}] the output dir did not copy itself into itself`);
  ok(readdirSync(outDir).length > 0, `[${outSpec}] the output is non-empty`);
}

rmSync(modDir, { recursive: true, force: true });
rmSync(fix, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ library configs load, and `weave build` handles the default publicDir.');
