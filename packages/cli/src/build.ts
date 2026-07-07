/** `weave build` — one-shot production bundle: JS via esbuild + one `app.css`. */

import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { weave, type WeaveState } from './plugin.js';
import { entryPlugin, VIRTUAL_ENTRY } from './entry.js';
import { compileStyleFileWithAssets, type StyleAsset, type StyleLang } from './styles.js';
import { injectHtml } from './html.js';

export interface BuildConfig {
  /** Hand-written entry module (absolute). Mutually exclusive with {@link virtualEntry}. */
  entry?: string;
  /** Framework-generated entry (Level C): the module source + the dir its imports resolve against. */
  virtualEntry?: { code: string; resolveDir: string };
  outDir: string;
  minify?: boolean;
  styleLang?: StyleLang;
  /** Global entry stylesheets (absolute paths), compiled + prepended to `app.css` in order. */
  styles?: string[];
  /** Static web root copied verbatim into the output dir (favicons, manifest, …). */
  publicDir?: string;
  /** HTML shell to copy into the output dir, with `<script>`/`<link>` injected. */
  index?: string;
  /** Wipe the output dir before building so it is a clean, self-contained artifact (default false — config mode opts in). */
  clean?: boolean;
}

export async function build(config: BuildConfig): Promise<void> {
  const { outDir } = config;
  if (config.clean) await rm(outDir, { recursive: true, force: true });

  const state: WeaveState = { css: [] };
  const ve: { code: string; resolveDir: string } | undefined = config.virtualEntry;
  await esbuild({
    // A virtual entry (Level C) is emitted as `main.js`; else the hand-written entry.
    entryPoints: ve ? [{ in: VIRTUAL_ENTRY, out: 'main' }] : [config.entry!],
    bundle: true,
    format: 'esm',
    // Code-split dynamic import()s into separate chunks, so `lazy()` routes are
    // actually their own files and <Link> prefetch (B.15) has something to warm.
    splitting: true,
    outdir: outDir,
    minify: config.minify ?? true,
    plugins: [
      weave(state, { styleLang: config.styleLang }),
      ...(ve ? [entryPlugin(ve.code, ve.resolveDir)] : []),
    ],
  });

  // Copy the static web root (favicons, manifest, the raw index.html) into the output;
  // the injected index.html below overwrites the raw copy.
  if (config.publicDir && existsSync(config.publicDir)) {
    await cp(config.publicDir, outDir, { recursive: true });
  }

  // Global entry styles (in declared order) first, then component scoped CSS. Each stylesheet's
  // url() assets (fonts, images) are rewritten to /assets/… and copied into the output.
  const compiledStyles: Array<{ css: string; assets: StyleAsset[] }> = await Promise.all(
    (config.styles ?? []).map(compileStyleFileWithAssets)
  );
  const globalCss: string = compiledStyles.map((s) => s.css).join('\n');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'app.css'), [globalCss, ...state.css].filter(Boolean).join('\n'));

  // Emit each referenced url() asset (deduped by served path) next to app.css.
  const seen: Set<string> = new Set();
  for (const asset of compiledStyles.flatMap((s) => s.assets)) {
    if (seen.has(asset.servedPath)) continue;
    seen.add(asset.servedPath);
    const dest: string = join(outDir, asset.servedPath);
    await mkdir(join(dest, '..'), { recursive: true });
    await cp(asset.absPath, dest);
  }

  // Copy the HTML shell into the output, injecting the entry script + stylesheet link
  // (and stripping any dev live-reload) so dist/ is self-contained + deployable.
  if (config.index) {
    const html: string = injectHtml(await readFile(config.index, 'utf8'), {
      script: '/main.js',
      css: '/app.css',
    });
    await writeFile(join(outDir, 'index.html'), html);
  }
}
