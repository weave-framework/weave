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
import { prerender } from './prerender.js';
// The DOM-free document types — the server render itself runs inside the bundled server entry (which installs
// the headless DOM); `prerender` assembles each document from strings, so no DOM is imported here.
import type { PageArtifact, DocumentOptions } from '@weave-framework/runtime/document';

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
  /** Phase E (E1.4): compile every component in the `resumable` target (for an SSG-resume client bundle). Default false. */
  resumable?: boolean;
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
      weave(state, { styleLang: config.styleLang, resumable: config.resumable }),
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

/** Config for {@link buildSsg} — the SPA client bundle plus a server entry to render each route headlessly. */
export interface SsgBuildConfig {
  /** Framework-generated CLIENT entry (Level C) — the CSR `mountComponent` bundle (`main.js`). */
  virtualEntry: { code: string; resolveDir: string };
  /** Framework-generated SERVER entry — `render(route)` → {@link PageArtifact} (from `generateServerEntry`). */
  serverEntry: { code: string; resolveDir: string };
  /** Mount selector — must be an `#id` (the SSG shell wraps the rendered app in a `<div id>` for CSR to adopt). */
  mount: string;
  /** Routes to prerender — one static `index.html` per route (default `['/']`, i.e. root-only). */
  routes?: string[];
  outDir: string;
  minify?: boolean;
  styleLang?: StyleLang;
  styles?: string[];
  publicDir?: string;
  /** `<title>` for the generated documents. */
  title?: string;
  /** `<html lang>` for the generated documents. */
  lang?: string;
  /**
   * Phase E (E1.4) — the islands mode. Compile BOTH bundles in the `resumable` target, so the server render
   * embeds the per-instance state snapshot + resume markers and the client entry ADOPTS that DOM in place
   * (`resumePage`) instead of a CSR remount. The caller must have generated the entries to match — the client
   * with `generateEntry(..., { resume: true })`, the server with `generateServerEntry(..., { resumable: true })`.
   * Default false → today's first-paint-shell + CSR-remount.
   */
  resume?: boolean;
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

/** A loaded server entry: call `render(route)` per route, then `dispose()` to remove the temp bundle. */
interface ServerRenderer {
  render: (route?: string) => PageArtifact | Promise<PageArtifact>;
  dispose: () => Promise<void>;
}

/** Bundle the server entry for Node and import it ONCE, returning its `render(route)` + a cleanup handle. */
async function loadServerEntry(
  serverEntry: { code: string; resolveDir: string },
  styleLang?: StyleLang,
  minify?: boolean,
  resumable?: boolean
): Promise<ServerRenderer> {
  const dir: string = await mkdtemp(join(tmpdir(), 'weave-ssg-'));
  const state: WeaveState = { css: [] }; // the server render needs no CSS collection — discarded
  await esbuild({
    entryPoints: [{ in: VIRTUAL_ENTRY, out: 'server' }],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outdir: dir,
    outExtension: { '.js': '.mjs' }, // a bare .js in a temp dir is CommonJS to Node; force ESM
    minify: minify ?? false,
    plugins: [weave(state, { styleLang, resumable }), entryPlugin(serverEntry.code, serverEntry.resolveDir)],
  });
  const mod: ServerRenderer = (await import(pathToFileURL(join(dir, 'server.mjs')).href)) as ServerRenderer;
  return { render: mod.render, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * `weave build --ssg` (Phase E, E1.3b/c) — static generation. Build the client CSR bundle (main.js + app.css +
 * public root) exactly like {@link build}, THEN render each route headlessly and write a complete
 * `<route>/index.html`: the server HTML inside the `#id` mount target, plus the client entry that mounts over
 * it. First paint + SEO come from the server HTML; interactivity comes from the CSR client.
 *
 * Root-only (E1.3b) renders one route (`/`); with the router-aware server entry (E1.3c) each route in
 * {@link SsgBuildConfig.routes} is rendered with `setServerLocation` so the router resolves it headlessly.
 *
 * `config.resume` (E1.4) flips both bundles to the `resumable` target: the server render embeds a per-instance
 * state snapshot + resume markers, and the client entry ADOPTS that DOM in place (`resumePage`) rather than
 * CSR-remounting — static content ships 0 JS. Default (false) is the first-paint-shell + CSR-remount.
 */
export async function buildSsg(config: SsgBuildConfig): Promise<void> {
  // 1. The client bundle + app.css + public root — same output as a normal build, minus the HTML shell
  //    (we generate the documents below instead of injecting into a hand-written index).
  await build({
    virtualEntry: config.virtualEntry,
    outDir: config.outDir,
    minify: config.minify,
    styleLang: config.styleLang,
    styles: config.styles,
    publicDir: config.publicDir,
    clean: true,
    resumable: config.resume,
  });
  // 2. Render each route headlessly (bundle + import the server entry once), writing a document per route.
  const id: string = mountId(config.mount);
  const head: string = '<link rel="stylesheet" href="/app.css">';
  const server: ServerRenderer = await loadServerEntry(config.serverEntry, config.styleLang, config.minify, config.resume);
  try {
    await prerender({
      outDir: config.outDir,
      routes: config.routes ?? ['/'],
      render: async (route: string): Promise<PageArtifact> => {
        const artifact: PageArtifact = await server.render(route);
        // E1.9 — surface any component the render could not make resumable (it will be client-rendered).
        for (const w of artifact.warnings ?? []) console.warn(`▲ weave build --ssg ${route}: ${w}`);
        // Wrap the server HTML in the #id mount target so the client CSR mounts over it; keep the captured
        // title so `renderDocument` fills each page's <title>.
        return {
          html: `<div id="${id}">${artifact.html}</div>`,
          snapshotScript: artifact.snapshotScript,
          title: artifact.title,
        };
      },
      document: (): DocumentOptions => ({ title: config.title, head, entry: '/main.js', lang: config.lang }),
    });
  } finally {
    await server.dispose();
  }
}
