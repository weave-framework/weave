/** `weave build` — one-shot production bundle: JS via esbuild + one `app.css`. */

import { build as esbuild } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { weave, type WeaveState } from './plugin.js';

export interface BuildConfig {
  entry: string;
  outdir: string;
  minify?: boolean;
}

export async function build(config: BuildConfig): Promise<void> {
  const state: WeaveState = { css: [] };
  await esbuild({
    entryPoints: [config.entry],
    bundle: true,
    format: 'esm',
    // Code-split dynamic import()s into separate chunks, so `lazy()` routes are
    // actually their own files and <Link> prefetch (B.15) has something to warm.
    splitting: true,
    outdir: config.outdir,
    minify: config.minify ?? true,
    plugins: [weave(state)],
  });
  await mkdir(config.outdir, { recursive: true });
  await writeFile(join(config.outdir, 'app.css'), state.css.join('\n'));
}
