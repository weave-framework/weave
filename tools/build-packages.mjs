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
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** tsc-emit library packages, in dependency order. */
const LIB_ORDER = ['runtime', 'compiler', 'prettier-plugin', 'store', 'i18n', 'data', 'forms', 'router', 'ui', 'check', 'mcp', 'nx'];

/** Copy every non-.ts asset under a package's src/ into its dist/ (e.g. Nx executor/generator
 *  schema.json files, which tsc does not emit but the Nx manifests reference at dist paths). */
function copyNonTsAssets(pkg) {
  const srcDir = join(repo, 'packages', pkg, 'src');
  const distDir = join(repo, 'packages', pkg, 'dist');
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (!entry.endsWith('.ts')) {
        const dest = join(distDir, relative(srcDir, full));
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(full, dest);
      }
    }
  };
  walk(srcDir);
}

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
  if (p === 'ui') {
    // ui components must be COMPILED (loader-style) before tsc, so dist ships a real
    // `export default defineComponent(render, setup)`. Stage src/ → .compiled/ with each
    // component pre-compiled, then tsc that staged tree. See tools/build-ui-components.mjs.
    run('node', ['tools/build-ui-components.mjs'], 'compile @weave-framework/ui components → .compiled');
    run('npx', ['tsc', '-p', 'packages/ui/tsconfig.compiled.json'], 'tsc build @weave-framework/ui');
    continue;
  }
  run('npx', ['tsc', '-p', `packages/${p}/tsconfig.build.json`], `tsc build @weave-framework/${p}`);
}

// Nx plugin: copy the executor/generator schema.json assets tsc doesn't emit (the Nx
// manifests reference them at dist/**/schema.json).
copyNonTsAssets('nx');

// CLI: declarations via tsc, runnable bundle via esbuild.
run('npx', ['tsc', '-p', 'packages/cli/tsconfig.build.json'], 'tsc d.ts @weave-framework/cli');
run('node', ['packages/cli/build.mjs'], 'esbuild bundle @weave-framework/cli');

// TypeScript-plugin (the WebStorm/editor `.ts`-side default-export synthesizer): its own esbuild
// bundle → dist/index.cjs. Published so a WebStorm project can install it and wire it into tsconfig.
run('node', ['packages/typescript-plugin/build.mjs'], 'esbuild bundle @weave-framework/typescript-plugin');

process.stdout.write('\n✓ All @weave-framework/* packages built to dist/\n');
