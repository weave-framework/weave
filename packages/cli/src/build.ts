/** `weave build` — one-shot production bundle: JS via esbuild + one `app.css`. */

import { build as esbuild } from 'esbuild';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { weave, type WeaveState } from './plugin.js';
import { entryPlugin, VIRTUAL_ENTRY } from './entry.js';
import { compileStyleFileWithAssets, type StyleAsset, type StyleLang } from './styles.js';
import { injectHtml, documentShell, type DocumentShell } from './html.js';
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
  /** Emit .js.map files alongside the bundle (default true). */
  sourcemap?: boolean;
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
  /**
   * Where the app is served from, when that is not the domain root — `/my-app/` for a GitHub Pages
   * project site, `/docs/` behind a reverse proxy. Every framework-injected URL is prefixed with it.
   * Default '' (the root).
   */
  base?: string;
  /**
   * Also write the shell as `404.html` — what a static host serves for an unknown path, and therefore
   * what makes a deep-link refresh work on a host with no rewrite rules (GitHub Pages is the common one).
   * Set for an app with client routes; pointless for a single-page one, so it is not the default.
   */
  spaFallback?: boolean;
}

/**
 * Normalize a base path to `''` (the root) or `/prefix` — leading slash, no trailing one, so a URL is
 * always `${base}/name` with exactly one separator however the author wrote it: `my-app`, `/my-app` and
 * `/my-app/` all mean the same place.
 */
export function normalizeBase(base: string | undefined): string {
  const trimmed: string = (base ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  return '/' + trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * A short content marker appended to an injected asset URL (`/main.js?v=1a2b3c`).
 *
 * Without one, a host or CDN holding `main.js` served yesterday's bundle against today's HTML for as long
 * as its TTL ran — a deploy that looks broken for a reason nothing on the page reveals. The value comes
 * from the file's own bytes, so an unchanged build keeps its URL (nothing re-downloads) and a changed one
 * cannot be answered from cache. FNV-1a over the content: a cache key, not a checksum.
 */
export function contentVersion(text: string): string {
  let h: number = 0x811c9dc5;
  for (let i: number = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Is `inner` the same path as, or inside, `outer`? */
function contains(outer: string, inner: string): boolean {
  const rel: string = relative(outer, inner);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Copy the static web root into the output dir, leaving the output dir itself behind.
 *
 * `publicDir` DEFAULTS to the config's own directory, so the equally default `outDir: 'dist'`
 * sits inside it — and Node's `cp` refuses that outright, before any `filter` runs:
 * `EINVAL … cannot copy <app> to a subdirectory of self <app>/dist`. An app that simply omits
 * `publicDir` — the documented default — failed its very first `weave build` with what reads
 * like a filesystem fault rather than a configuration one. So when the output is nested, walk
 * the tree and skip that one branch.
 */
async function copyPublicDir(publicDir: string, outDir: string): Promise<void> {
  if (!contains(publicDir, outDir)) {
    await cp(publicDir, outDir, { recursive: true });
    return;
  }
  await copyTreeExcept(publicDir, outDir, outDir);
}

/** Copy `srcDir` → `destDir`, omitting the `exclude` branch (an absolute path inside `srcDir`). */
async function copyTreeExcept(srcDir: string, destDir: string, exclude: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src: string = join(srcDir, entry.name);
    if (relative(src, exclude) === '') continue; // this IS the output dir
    const dest: string = join(destDir, entry.name);
    // A deeper `outDir` (say `build/dist`) makes this child a self-copy in turn — recurse
    // instead of handing `cp` the same refusal one level down.
    if (entry.isDirectory() && contains(src, exclude)) await copyTreeExcept(src, dest, exclude);
    else await cp(src, dest, { recursive: true });
  }
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
    // Linked maps (a separate .js.map) so a production stack trace resolves to the author's source. Opt
    // out with `build.sourcemap: false` in weave.config.ts if the maps should not be published.
    sourcemap: config.sourcemap === false ? false : 'linked',
    plugins: [
      weave(state, { styleLang: config.styleLang, resumable: config.resumable }),
      ...(ve ? [entryPlugin(ve.code, ve.resolveDir)] : []),
    ],
  });

  // Copy the static web root (favicons, manifest, the raw index.html) into the output;
  // the injected index.html below overwrites the raw copy.
  if (config.publicDir && existsSync(config.publicDir)) {
    await copyPublicDir(config.publicDir, outDir);
  }

  // Global entry styles (in declared order) first, then component scoped CSS. Each stylesheet's
  // url() assets (fonts, images) are rewritten to /assets/… and copied into the output.
  const compiledStyles: Array<{ css: string; assets: StyleAsset[] }> = await Promise.all(
    (config.styles ?? []).map(compileStyleFileWithAssets)
  );
  const globalCss: string = compiledStyles.map((s) => s.css).join('\n');
  await mkdir(outDir, { recursive: true });
  const css: string = [globalCss, ...state.css].filter(Boolean).join('\n');
  await writeFile(join(outDir, 'app.css'), css);

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
    const base: string = normalizeBase(config.base);
    const jsVersion: string = contentVersion(await readFile(join(outDir, 'main.js'), 'utf8').catch(() => ''));
    const html: string = injectHtml(await readFile(config.index, 'utf8'), {
      script: `${base}/main.js?v=${jsVersion}`,
      css: `${base}/app.css?v=${contentVersion(css)}`,
      base,
    });
    await writeFile(join(outDir, 'index.html'), html);
    // A router app refreshed on `/about` asks the host for a page that does not exist. Hosts with rewrite
    // rules can be told to answer with the shell; GitHub Pages cannot — it serves `404.html`. Writing the
    // same document there costs one file and turns a broken refresh into a working one.
    if (config.spaFallback) await writeFile(join(outDir, '404.html'), html);
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
  /** `<html lang>` for the generated documents — the fallback when there is no {@link index} to read. */
  lang?: string;
  /** The app's own HTML shell. Its `<html>` attributes and `<head>` are inherited by every generated page. */
  index?: string;
  /** Where the app is served from, when that is not the domain root (see {@link BuildConfig.base}). */
  base?: string;
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
    plugins: [
      weave(state, { styleLang, resumable }),
      entryPlugin(serverEntry.code, serverEntry.resolveDir),
    ],
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
    base: config.base,
    clean: true,
    resumable: config.resume,
  });
  const base: string = normalizeBase(config.base);
  // 2. Render each route headlessly (bundle + import the server entry once), writing a document per route.
  const id: string = mountId(config.mount);
  // The author's own document is the shell. Synthesizing one from scratch dropped everything it said —
  // viewport, lang, description, favicon, `<base>` — so a generated page was a different document from
  // every hand-served one, and relative URLs on a nested route resolved against the wrong directory.
  const shell: DocumentShell = config.index
    ? documentShell(await readFile(config.index, 'utf8'))
    : { htmlAttrs: '', head: '' };
  const cssLink: string =
    `<link rel="stylesheet" href="${base}/app.css">` +
    // Published from the document, before the entry module: `import` hoists, so a base assigned inside
    // the bundle would land after the router had already read it.
    (base ? `<script>window.__WEAVE_BASE__=${JSON.stringify(base)}</script>` : '');
  const head: string = /<link[^>]+href=["']\/app\.css["']/i.test(shell.head)
    ? shell.head
    : shell.head
      ? `${shell.head}\n${cssLink}`
      : cssLink;
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
      document: (): DocumentOptions => ({
        title: config.title,
        head,
        entry: `${base}/main.js`,
        lang: config.lang,
        // `lang` stays as the fallback for an app with no index.html of its own.
        ...(shell.htmlAttrs ? { htmlAttrs: shell.htmlAttrs } : {}),
      }),
    });
  } finally {
    await server.dispose();
  }
}
