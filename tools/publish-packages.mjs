/**
 * Publish the @weave-framework/* packages (+ create-weave) to npm, in dependency order.
 *
 * REQUIRES: you are logged in to npm (`npm login`) with rights to the @weave
 * scope/org, and the @weave org exists on npm with public publishing enabled.
 * This script does NOT log you in and cannot publish without your credentials.
 *
 * It uses `pnpm publish`, which rewrites `workspace:*` → the concrete version
 * (0.2.0) at publish time. Order matters so each rewritten dep already exists on
 * the registry when the next package publishes.
 *
 * Usage:
 *   node tools/publish-packages.mjs --dry-run   # pack + validate, no upload
 *   node tools/publish-packages.mjs             # real publish (after `npm login`)
 *
 * The bundled language-server is intentionally NOT here (it ships inside the editor plugins).
 * `typescript-plugin` IS published — a WebStorm project installs it and wires it into tsconfig
 * `compilerOptions.plugins` to get the synthesized default export (`.ts`-side TS1192 fix).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

// Dependency order — a package's @weave deps must be on the registry first.
// `weave-framework` is a deps-only meta-package (installs the core) — publish it LAST, after its deps exist.
const ORDER = ['runtime', 'compiler', 'prettier-plugin', 'store', 'i18n', 'data', 'forms', 'router', 'ui', 'check', 'typescript-plugin', 'mcp', 'nx', 'cli', 'create-weave', 'weave-framework'];

// Always build fresh dist/ before publishing the library + CLI packages.
{
  const r = spawnSync('node', ['tools/build-packages.mjs'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/**
 * Is `name@version` already on the registry?
 *
 * This exists because the old failure message promised something npm does not do. It said "already-published
 * packages will be skipped by npm" — they are not: publishing over an existing version fails with E403. So a
 * run that died on package 9 of 16 could not simply be re-run; it died again on package 1, leaving a
 * half-published lockstep release with no documented way forward, exactly when the operator is under
 * pressure. Checking first makes a re-run resume where it stopped, which is what the message always claimed.
 */
function alreadyPublished(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd: repo,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  // A missing package/version exits non-zero (E404) — that is the "not published" answer, not a failure.
  return r.status === 0 && String(r.stdout).trim() === version;
}

for (const p of ORDER) {
  const pkg = JSON.parse(readFileSync(join(repo, 'packages', p, 'package.json'), 'utf8'));
  if (!dryRun && alreadyPublished(pkg.name, pkg.version)) {
    process.stdout.write(`\n• ${pkg.name}@${pkg.version} already on the registry — skipping\n`);
    continue;
  }
  const args = ['publish', '--access', 'public', '--no-git-checks'];
  if (dryRun) args.push('--dry-run');
  process.stdout.write(`\n▶ pnpm ${args.join(' ')}  (packages/${p})\n`);
  const r = spawnSync('pnpm', args, { cwd: join(repo, 'packages', p), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(
      `\n✖ publish failed for ${pkg.name}@${pkg.version} (exit ${r.status}).\n` +
        `  Fix the cause and re-run: packages already on the registry are detected and skipped, so the run\n` +
        `  resumes at this one rather than failing on the first.\n`
    );
    process.exit(r.status ?? 1);
  }
}

process.stdout.write(`\n✓ ${dryRun ? 'Dry-run' : 'Published'} ${ORDER.length} packages.\n`);
