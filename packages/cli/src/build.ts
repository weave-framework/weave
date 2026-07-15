/** `weave build` — one-shot production bundle: JS via esbuild + one `app.css`. */

import { build as esbuild } from 'esbuild';
import { mkdir, mkdtemp, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { weave, type WeaveState } from './plugin.js';
import { entryPlugin, VIRTUAL_ENTRY } from './entry.js';
import { compileStyleFileWithAssets, type StyleAsset, type StyleLang } from './styles.js';
import { injectHtml } from './html.js';
// The DOM-free document assembler (renderDocument + PageArtifact) — the server render itself runs inside the
// bundled server entry, which installs the headless DOM; here we only stitch strings, so no DOM is imported.
import { renderDocument, type PageArtifact } from '@weave-framework/runtime/document';

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

/** Config for {@link buildSsg} — the SPA client bundle plus a server entry to render the root headlessly. */
export interface SsgBuildConfig {
  /** Framework-generated CLIENT entry (Level C) — the CSR `mountComponent` bundle (`main.js`). */
  virtualEntry: { code: string; resolveDir: string };
  /** Framework-generated SERVER entry — `render()` → {@link PageArtifact} (from `generateServerEntry`). */
  serverEntry: { code: string; resolveDir: string };
  /** Mount selector — must be an `#id` (the SSG shell wraps the rendered app in a `<div id>` for CSR to adopt). */
  mount: string;
  outDir: string;
  minify?: boolean;
  styleLang?: StyleLang;
  styles?: string[];
  publicDir?: string;
  /** `<title>` for the generated document. */
  title?: string;
  /** `<html lang>` for the generated document. */
  lang?: string;
}

/** The mount `#id` an SSG shell wraps the app in. Fails loud if the selector is not a plain `#id`. */
function mountId(selector: string): string {
  const m: RegExpMatchArray | null = /^#([A-Za-z][\w-]*)$/.exec(selector.trim());
  if (!m) {
    throw new Error(
      `weave build --ssg: mount selector "${selector}" must be an #id — the SSG shell wraps the app in ` +
        `<div id="…"> for the client to mount into. Set config.mount to e.g. "#app".`
    );
  }
  return m[1];
}

/** Bundle the server entry for Node, import it, and call its `render()` to get the page artifact. */
async function renderServerEntry(
  serverEntry: { code: string; resolveDir: string },
  styleLang?: StyleLang,
  minify?: boolean
): Promise<PageArtifact> {
  const dir: string = await mkdtemp(join(tmpdir(), 'weave-ssg-'));
  const state: WeaveState = { css: [] }; // the server render needs no CSS collection — discarded
  try {
    await esbuild({
      entryPoints: [{ in: VIRTUAL_ENTRY, out: 'server' }],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outdir: dir,
      outExtension: { '.js': '.mjs' }, // a bare .js in a temp dir is CommonJS to Node; force ESM
      minify: minify ?? false,
      plugins: [weave(state, { styleLang }), entryPlugin(serverEntry.code, serverEntry.resolveDir)],
    });
    const mod: { render: () => PageArtifact | Promise<PageArtifact> } = (await import(
      pathToFileURL(join(dir, 'server.mjs')).href
    )) as { render: () => PageArtifact | Promise<PageArtifact> };
    return await mod.render();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `weave build --ssg` (Phase E, E1.3b) — root-render static generation. Build the client CSR bundle (main.js +
 * app.css + public root) exactly like {@link build}, THEN render the root component headlessly to HTML and
 * write a complete `index.html`: the server HTML inside the `#id` mount target, plus the client entry that
 * mounts over it. First paint + SEO come from the server HTML; interactivity comes from the CSR client.
 *
 * Root-only for now: it renders the configured `root` with no router. Per-route SSG (rendering each route's
 * component with its own state) is router-SSR — the next slice (E1.3c). `resumePage` (adopt the server DOM
 * instead of re-rendering) also lands then, once real per-page state is captured.
 */
export async function buildSsg(config: SsgBuildConfig): Promise<void> {
  // 1. The client bundle + app.css + public root — same output as a normal build, minus the HTML shell
  //    (we generate the document below instead of injecting into a hand-written index).
  await build({
    virtualEntry: config.virtualEntry,
    outDir: config.outDir,
    minify: config.minify,
    styleLang: config.styleLang,
    styles: config.styles,
    publicDir: config.publicDir,
    clean: true,
  });
  // 2. Render the root headlessly.
  const artifact: PageArtifact = await renderServerEntry(config.serverEntry, config.styleLang, config.minify);
  // 3. Assemble + write the document: server HTML inside the mount target, snapshot, client entry, styles.
  const id: string = mountId(config.mount);
  const doc: string = renderDocument(
    { html: `<div id="${id}">${artifact.html}</div>`, snapshotScript: artifact.snapshotScript },
    { title: config.title, head: '<link rel="stylesheet" href="/app.css">', entry: '/main.js', lang: config.lang }
  );
  await writeFile(join(config.outDir, 'index.html'), doc);
}
