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
import { fileURLToPath } from 'node:url';

export type StyleLang = 'css' | 'scss' | 'sass';

/** The style language implied by a file extension (defaults to plain CSS). */
export function langFromExt(file: string): StyleLang {
  if (file.endsWith('.scss')) return 'scss';
  if (file.endsWith('.sass')) return 'sass';
  return 'css';
}

/** Compile a style FILE to CSS — `@use`/`@import` resolve relative to it. */
export async function compileStyleFile(path: string): Promise<string> {
  if (langFromExt(path) === 'css') return readFile(path, 'utf8');
  const sass: typeof import('sass') = await import('sass'); // lazy — only when scss/sass is in play
  return sass.compile(path).css; // sass infers scss vs indented from the extension
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
  const result: import('sass').CompileResult = sass.compile(path);
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
  }).css;
}
