#!/usr/bin/env node
/**
 * Bootstrap runner: bundle the typed CLI source on the fly (esbuild inlines
 * @weave/compiler, esbuild itself stays external) and run it. Lets the CLI be
 * authored as type-checked TS without a separate build step.
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Emit under the repo's node_modules so the externalized `esbuild` import
// resolves via normal upward module lookup.
const cacheDir = join(resolve(here, '../../..'), 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'cli.mjs');

await esbuild({
  entryPoints: [join(here, '../src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  // Keep heavy native/peer deps out of the on-the-fly bundle — resolved at runtime
  // via normal upward node_modules lookup from `node_modules/.weave/cli.mjs`.
  external: ['esbuild', 'typescript'],
  outfile: out,
});

const { main } = await import(pathToFileURL(out).href);
await main(process.argv.slice(2));
