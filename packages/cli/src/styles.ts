/**
 * Style compilation — turns a component's or app's authored styles (`.scss` /
 * `.sass` / `.css`) into plain CSS. Sass is a **lazy** dev-dependency: it is only
 * imported when a `.scss`/`.sass` source is actually compiled, so a pure-CSS app
 * never loads it. `.css` passes through untouched (zero cost).
 *
 * Two entry points: file-based (resolves `@use`/`@import` relative to the file)
 * and string-based (for inline `.weave` `<style>` blocks).
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export type StyleLang = 'css' | 'scss' | 'sass';

/** An asset a stylesheet references via `url(...)` — copied to the output / served in dev. */
export interface StyleAsset {
  /** Absolute path to the source file on disk. */
  absPath: string;
  /** Output-relative path it is emitted/served at (no leading slash), e.g. `assets/ab12cd34-font.woff2`. */
  servedPath: string;
}

// A `url(...)` reference: optional quote, then the ref (up to the closing quote/paren).
const URL_RE: RegExp = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** A url() ref the pipeline must leave alone — absolute, protocol, data:, or a bare fragment. */
function isExternalRef(ref: string): boolean {
  return (
    /^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('/') || ref.startsWith('#')
  );
}

/**
 * Rewrite a compiled stylesheet's **relative** `url(...)` references (fonts, images) to a
 * stable `/assets/<hash>-<name>` path and report each asset to copy/serve. Refs are resolved
 * against `baseDir` (the stylesheet's own directory); external/absolute/data: refs and refs
 * whose target doesn't exist on disk are left untouched. Same source file → same served path
 * (deduped by absolute path), so repeated refs share one emitted asset.
 */
export function rewriteStyleAssets(css: string, baseDir: string): { css: string; assets: StyleAsset[] } {
  const byAbs: Map<string, string> = new Map<string, string>(); // absPath → servedPath (dedupe)
  const assets: StyleAsset[] = [];
  const out: string = css.replace(URL_RE, (whole: string, _q: string, ref: string): string => {
    const raw: string = ref.trim();
    if (isExternalRef(raw)) return whole;
    const suffix: string = raw.match(/[?#].*$/)?.[0] ?? ''; // preserve ?query / #fragment
    const filePart: string = suffix ? raw.slice(0, -suffix.length) : raw;
    const absPath: string = resolve(baseDir, filePart);
    if (!existsSync(absPath)) return whole; // unknown target — don't break it
    let servedPath: string | undefined = byAbs.get(absPath);
    if (!servedPath) {
      const hash: string = createHash('sha1').update(absPath).digest('hex').slice(0, 8);
      servedPath = `assets/${hash}-${basename(absPath)}`;
      byAbs.set(absPath, servedPath);
      assets.push({ absPath, servedPath });
    }
    return `url(/${servedPath}${suffix})`;
  });
  return { css: out, assets };
}

/** The style language implied by a file extension (defaults to plain CSS). */
export function langFromExt(file: string): StyleLang {
  if (file.endsWith('.scss')) return 'scss';
  if (file.endsWith('.sass')) return 'sass';
  return 'css';
}

/**
 * A `pkg:` importer so stylesheets can pull a published package's Sass entry the standard
 * way — `@use 'pkg:@weave-framework/ui'` resolves via that package's `sass`/`style` export
 * condition (node_modules resolution). Without it, only relative `@use` paths work.
 */
function pkgImporters(sass: typeof import('sass')): import('sass').NodePackageImporter[] {
  return [new sass.NodePackageImporter()];
}

/** Compile a style FILE to CSS — `@use`/`@import` resolve relative to it (+ `pkg:` packages). */
export async function compileStyleFile(path: string): Promise<string> {
  if (langFromExt(path) === 'css') return readFile(path, 'utf8');
  const sass: typeof import('sass') = await import('sass'); // lazy — only when scss/sass is in play
  return sass.compile(path, { importers: pkgImporters(sass) }).css; // sass infers scss vs indented from the extension
}

/**
 * Compile a style FILE and process its `url(...)` asset references: relative refs are rewritten
 * to `/assets/<hash>-<name>` and returned as {@link StyleAsset}s for the caller to copy (build)
 * or serve (dev). `url()`s are resolved against the stylesheet's own directory — exact for a
 * plain `.css` (e.g. an `@fontsource` sheet); for `.scss`, refs authored in `@use`/`@import`
 * partials resolve against the ENTRY's dir, so keep asset `url()`s in the entry or use absolute.
 */
export async function compileStyleFileWithAssets(
  path: string
): Promise<{ css: string; assets: StyleAsset[] }> {
  const compiled: string = await compileStyleFile(path);
  return rewriteStyleAssets(compiled, dirname(path));
}

/**
 * Like {@link compileStyleFile} but also reports every file the compile pulled in —
 * the entry itself plus any `@use`/`@import` partials (from sass's `loadedUrls`). The
 * dev loader feeds these to esbuild's `watchFiles` so editing a partial (e.g. a tokens
 * file) rebuilds the components that depend on it.
 */
export async function compileStyleFileTracked(path: string): Promise<{ css: string; files: string[] }> {
  if (langFromExt(path) === 'css') return { css: await readFile(path, 'utf8'), files: [path] };
  const sass: typeof import('sass') = await import('sass');
  const result: import('sass').CompileResult = sass.compile(path, { importers: pkgImporters(sass) });
  const files: string[] = result.loadedUrls
    .filter((u: URL): boolean => u.protocol === 'file:')
    .map((u: URL): string => fileURLToPath(u));
  return { css: result.css, files };
}

/** Compile a style STRING (inline `.weave` block) of `lang` to CSS. */
export async function compileStyleSource(
  source: string,
  lang: StyleLang,
  fromDir?: string
): Promise<string> {
  if (lang === 'css' || !source.trim()) return source;
  const sass: typeof import('sass') = await import('sass');
  return sass.compileString(source, {
    syntax: lang === 'sass' ? 'indented' : 'scss',
    loadPaths: fromDir ? [fromDir] : [],
    importers: pkgImporters(sass),
  }).css;
}
