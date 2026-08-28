#!/usr/bin/env node
/**
 * DEV bin (monorepo): bundle the typed CLI source on the fly (esbuild inlines
 * @weave-framework/compiler/@weave-framework/check; esbuild/typescript/sass stay external) and run it.
 * Lets the CLI run from live `src/` with no build step during development.
 *
 * For the PUBLISHED package, package.json `publishConfig.bin` swaps this for
 * bin/weave-dist.mjs (a thin launcher over the prebuilt dist/cli.js) — so end
 * users get a fast, build-free launch with no monorepo-layout assumptions.
 */
import { build as esbuild } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// `files: ["dist", "bin"]` ships this dev bin inside the published tarball too, where `src/` does not
// exist — running it there used to die on `Could not resolve …/src/cli.ts` with an esbuild stack. It is
// not the published entry point (publishConfig.bin points at weave-dist.mjs), but anything shipped has
// to work when someone runs it. With no source to bundle, hand over to the prebuilt CLI.
const source = join(here, '../src/cli.ts');
if (!existsSync(source)) {
  const { main } = await import(pathToFileURL(join(here, '../dist/cli.js')).href);
  await main(process.argv.slice(2));
  process.exit(0);
}

const cacheDir = join(resolve(here, '../../..'), 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'cli.mjs');

await esbuild({
  entryPoints: [source],
  bundle: true,
  format: 'esm',
  platform: 'node',
  // NB: @weave-framework/mcp stays INLINED in the dev bin (unlike the prod build, which
  // externalizes it) — the dev bundle runs from node_modules/.weave/, whose module
  // resolution can't reach the workspace-linked package, so we bundle it in.
  external: ['esbuild', 'typescript', 'sass'],
  outfile: out,
});

const { main } = await import(pathToFileURL(out).href);
await main(process.argv.slice(2));
