/**
 * Build every publishable @weave-framework/* package to its dist/ (the form that ships to
 * npm). Library packages emit via `tsc -p tsconfig.build.json` (.js + .d.ts,
 * module structure preserved); the CLI emits declarations via tsc and bundles
 * its runnable dist/cli.js via esbuild (see packages/cli/build.mjs).
 *
 * Order follows the @weave dependency graph so each package's deps are built
 * first (matters for tsc resolving @weave-framework/* .d.ts from already-built dist).
 *
 * Run: `node tools/build-packages.mjs` (or `pnpm build:packages`).
 * The actual `npm publish` is a separate, credentialed step (publish in this
 * same order so pnpm's workspace:* → version rewrite resolves on the registry).
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** tsc-emit library packages, in dependency order. */
const LIB_ORDER = ['runtime', 'compiler', 'store', 'i18n', 'data', 'forms', 'router', 'ui', 'check', 'mcp'];

function run(cmd, args, label) {
  process.stdout.write(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.stderr.write(`\n✖ ${label} failed (exit ${r.status})\n`);
    process.exit(r.status ?? 1);
  }
}

// Clean prior outputs so removed files don't linger in a tarball.
for (const p of [...LIB_ORDER, 'cli']) {
  rmSync(join(repo, 'packages', p, 'dist'), { recursive: true, force: true });
}

for (const p of LIB_ORDER) {
  run('npx', ['tsc', '-p', `packages/${p}/tsconfig.build.json`], `tsc build @weave-framework/${p}`);
}

// CLI: declarations via tsc, runnable bundle via esbuild.
run('npx', ['tsc', '-p', 'packages/cli/tsconfig.build.json'], 'tsc d.ts @weave-framework/cli');
run('node', ['packages/cli/build.mjs'], 'esbuild bundle @weave-framework/cli');

process.stdout.write('\n✓ All @weave-framework/* packages built to dist/\n');
