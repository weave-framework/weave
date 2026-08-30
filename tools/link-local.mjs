/**
 * Point an app at THIS checkout instead of npm, so a framework fix can be tested without publishing.
 *
 * The naive version of this — `pnpm link`, or a `file:` dependency on `packages/<name>` — is worse
 * than useless here, and quietly so: in the monorepo every package's `main` is `./src/index.ts`, and
 * only `publishConfig` swaps it to `./dist/index.js` AT PUBLISH TIME. An app linked that way consumes
 * TypeScript source, which is not the artifact anyone installs, so a green result proves nothing about
 * what shipping would do.
 *
 * `pnpm pack` applies `publishConfig`, so a packed tarball has the published shape — `dist/`, the
 * rewritten `main`, and `workspace:*` resolved to the concrete version. That is what this installs.
 *
 * Usage:
 *   node tools/link-local.mjs <appDir>            pack this checkout and install it into the app
 *   node tools/link-local.mjs <appDir> --restore  put the app's version ranges back
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = [
  'runtime', 'compiler', 'prettier-plugin', 'store', 'i18n', 'data', 'forms', 'router',
  'ui', 'check', 'typescript-plugin', 'mcp', 'nx', 'cli', 'create-weave', 'weave-framework',
];

const args = process.argv.slice(2);
const appDir = resolve(args.find((a) => !a.startsWith('-')) ?? '');
const restore = args.includes('--restore');
const manifest = join(appDir, 'package.json');

if (!existsSync(manifest)) {
  console.error(`No package.json at ${appDir}\n\n  node tools/link-local.mjs <appDir> [--restore]`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
const SAVED = '_weaveLinkedFrom';

/** Every `@weave-framework/*` (plus the two unscoped ones) this app depends on, by section. */
const weaveDeps = () => {
  const out = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (name.startsWith('@weave-framework/') || name === 'weave-framework' || name === 'create-weave') {
        out.push({ section, name });
      }
    }
  }
  return out;
};

if (restore) {
  const saved = pkg[SAVED];
  if (!saved) {
    console.error('This app is not linked (no record of the ranges it had). Nothing changed.');
    process.exit(1);
  }
  for (const { section, name, range } of saved.deps) pkg[section][name] = range;
  // Put the override blocks back exactly as they were, including "there was none".
  if (saved.hadOverrides === null) delete pkg.overrides;
  else pkg.overrides = saved.hadOverrides;
  if (saved.hadPnpm === null) delete pkg.pnpm;
  else pkg.pnpm = saved.hadPnpm;
  delete pkg[SAVED];
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`+ restored ${saved.deps.length} dependency range(s) in ${manifest}`);
  console.log("  Delete the lockfile and install again to pull them from npm.");
  process.exit(0);
}

const deps = weaveDeps();
if (!deps.length) {
  console.error(`${manifest} does not depend on any Weave package.`);
  process.exit(1);
}
if (pkg[SAVED]) {
  console.error('This app is already linked. Run with --restore first if you want to re-link.');
  process.exit(1);
}

/* ── 1. Build, then pack every package the way npm would receive it ── */
console.log('building packages…');
execFileSync('pnpm', ['build:packages'], { cwd: repo, stdio: 'inherit', shell: true });

const packs = join(repo, '.packs');
rmSync(packs, { recursive: true, force: true });
mkdirSync(packs, { recursive: true });
console.log('\npacking…');
for (const p of PACKAGES) {
  execFileSync('pnpm', ['pack', '--pack-destination', packs], {
    cwd: join(repo, 'packages', p),
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  });
}

/** package name → the tarball just written for it, keyed by what its own manifest says. */
const tarballs = new Map();
for (const file of readdirSync(packs)) {
  if (!file.endsWith('.tgz')) continue;
  const name = execFileSync('tar', ['-xzOf', file, 'package/package.json'], { cwd: packs, encoding: 'utf8' });
  tarballs.set(JSON.parse(name).name, join(packs, file));
}
console.log(`+ ${tarballs.size} tarball(s) in ${packs}`);

/* ── 2. Rewrite the app's ranges, remembering what they were ── */
const local = (name) => 'file:' + (tarballs.get(name) ?? '').split('\\').join('/');
const saved = [];
for (const { section, name } of deps) {
  if (!tarballs.has(name)) {
    console.error(`  ! ${name} is a dependency of the app but not published from this checkout — left alone`);
    continue;
  }
  saved.push({ section, name, range: pkg[section][name] });
  pkg[section][name] = local(name);
}

// Direct dependencies are not enough, and the failure is loud but confusing: the packed `cli` asks for
// `@weave-framework/mcp` at this checkout's version, which is not on npm, so the install dies with
// ETARGET naming a package the app never mentioned. Every Weave package is overridden, not just the
// ones the app lists, so no transitive request escapes to the registry.
const overrides = {};
for (const [name, file] of tarballs) overrides[name] = 'file:' + file.split('\\').join('/');
pkg[SAVED] = {
  repo,
  deps: saved,
  hadOverrides: Object.prototype.hasOwnProperty.call(pkg, 'overrides') ? pkg.overrides : null,
  hadPnpm: Object.prototype.hasOwnProperty.call(pkg, 'pnpm') ? pkg.pnpm : null,
};
pkg.overrides = { ...pkg.overrides, ...overrides }; // npm / yarn
pkg.pnpm = { ...pkg.pnpm, overrides: { ...pkg.pnpm?.overrides, ...overrides } }; // pnpm
writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');

console.log(`+ pointed ${saved.length} dependency/ies at this checkout, and overrode all ${tarballs.size}`);
for (const s of saved) console.log(`    ${s.name}  ${s.range}  →  local`);
console.log('\nNow install in the app (delete its lockfile first), then build it. To go back:');
console.log(`  node tools/link-local.mjs "${appDir}" --restore`);
