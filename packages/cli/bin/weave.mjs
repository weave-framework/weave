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
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(resolve(here, '../../..'), 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'cli.mjs');

await esbuild({
  entryPoints: [join(here, '../src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['esbuild', 'typescript', 'sass'],
  outfile: out,
});

const { main } = await import(pathToFileURL(out).href);
await main(process.argv.slice(2));
