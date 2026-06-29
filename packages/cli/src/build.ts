/** `weave build` — one-shot production bundle: JS via esbuild + one `app.css`. */

import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { weave, type WeaveState } from './plugin.js';
import { compileStyleFile, type StyleLang } from './styles.js';

export interface BuildConfig {
  entry: string;
  outDir: string;
  minify?: boolean;
  styleLang?: StyleLang;
  /** Global entry stylesheets (absolute paths), compiled + prepended to `app.css` in order. */
  styles?: string[];
  /** HTML shell to copy into the output dir, with `<script>`/`<link>` injected. */
  index?: string;
  /** Wipe the output dir before building so it is a clean, self-contained artifact (default false — config mode opts in). */
  clean?: boolean;
}

export async function build(config: BuildConfig): Promise<void> {
  const { outDir } = config;
  if (config.clean) await rm(outDir, { recursive: true, force: true });

  const state: WeaveState = { css: [] };
  await esbuild({
    entryPoints: [config.entry],
    bundle: true,
    format: 'esm',
    // Code-split dynamic import()s into separate chunks, so `lazy()` routes are
    // actually their own files and <Link> prefetch (B.15) has something to warm.
    splitting: true,
    outdir: outDir,
    minify: config.minify ?? true,
    plugins: [weave(state, { styleLang: config.styleLang })],
  });

  // Global entry styles (in declared order) first, then component scoped CSS.
  const globalCss = (await Promise.all((config.styles ?? []).map(compileStyleFile))).join('\n');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'app.css'), [globalCss, ...state.css].filter(Boolean).join('\n'));

  // Copy the HTML shell into the output, making it self-contained + deployable.
  if (config.index) {
    const html = injectIndexHtml(await readFile(config.index, 'utf8'));
    await writeFile(join(outDir, 'index.html'), html);
  }
}

/**
 * Make `index.html` reference the build output: ensure a `<script type=module>` for
 * `main.js` and a `<link>` for `app.css`, and strip the dev-only live-reload snippet.
 */
function injectIndexHtml(html: string): string {
  // The `(?:(?!-->)[\s\S])*?` guards keep each match WITHIN one comment/script, so it
  // can't span from an earlier comment to the live-reload one and eat the body between.
  let out = html
    // drop the dev live-reload comment + its `<script>…EventSource('/esbuild')…</script>`
    .replace(/[ \t]*<!--(?:(?!-->)[\s\S])*?live-reload(?:(?!-->)[\s\S])*?-->\n?/gi, '')
    .replace(/[ \t]*<script>(?:(?!<\/script>)[\s\S])*?EventSource\(\s*['"]\/esbuild['"][\s\S]*?<\/script>\n?/gi, '');

  // Root-absolute paths so a client route refresh (SPA fallback serves index.html for
  // /task/42) still resolves the assets — a relative `./main.js` would 404 there.
  if (!/<link[^>]+app\.css/i.test(out)) {
    out = out.replace(/<\/head>/i, '    <link rel="stylesheet" href="/app.css" />\n  </head>');
  }
  if (!/<script[^>]+src=["']\/?main\.js["']/i.test(out)) {
    out = out.replace(/<\/body>/i, '    <script type="module" src="/main.js"></script>\n  </body>');
  }
  return out;
}
