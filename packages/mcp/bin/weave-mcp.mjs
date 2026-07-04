#!/usr/bin/env node
/**
 * DEV bin (monorepo): bundle the typed MCP server source on the fly (esbuild inlines
 * @weave-framework/compiler/check/router; typescript/sass/esbuild stay external) and run it
 * over stdio. Lets `weave-mcp` run from live `src/` with no build step during development.
 *
 * For the PUBLISHED package, package.json `publishConfig.bin` swaps this for
 * bin/weave-mcp-dist.mjs (a thin launcher over the prebuilt dist/index.js).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));
const cacheDir = join(resolve(here, '../../..'), 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'mcp.mjs');

await esbuild({
  entryPoints: [join(here, '../src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript', 'sass', 'esbuild'],
  outfile: out,
});

const { runStdioServer } = await import(pathToFileURL(out).href);
await runStdioServer({ version: pkg.version });
