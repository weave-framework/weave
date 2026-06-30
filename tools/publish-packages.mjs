/**
 * Publish the @weave/* packages (+ create-weave) to npm, in dependency order.
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
 * Editor tooling (language-server, typescript-plugin) is intentionally NOT here —
 * publish those on their own track if/when desired.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

// Dependency order — a package's @weave deps must be on the registry first.
const ORDER = ['runtime', 'compiler', 'store', 'i18n', 'data', 'forms', 'router', 'check', 'cli', 'create-weave'];

// Always build fresh dist/ before publishing the library + CLI packages.
{
  const r = spawnSync('node', ['tools/build-packages.mjs'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const p of ORDER) {
  const args = ['publish', '--access', 'public', '--no-git-checks'];
  if (dryRun) args.push('--dry-run');
  process.stdout.write(`\n▶ pnpm ${args.join(' ')}  (packages/${p})\n`);
  const r = spawnSync('pnpm', args, { cwd: join(repo, 'packages', p), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(`\n✖ publish failed for @weave/${p === 'create-weave' ? '' : ''}${p} (exit ${r.status}). Fix and re-run; already-published packages will be skipped by npm.\n`);
    process.exit(r.status ?? 1);
  }
}

process.stdout.write(`\n✓ ${dryRun ? 'Dry-run' : 'Published'} ${ORDER.length} packages.\n`);
