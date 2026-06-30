/**
 * The Weave esbuild plugin — the canonical loader (the inlined copy in
 * `tools/verify-build.mjs` mirrors this). Compiles two authoring forms into one
 * ES module each:
 *
 *  - `.weave` SFC (split by `parseSfc`)
 *  - separate files (Angular-style): a `.ts` with a co-located `<base>.<styleLang>`
 *    template's `<base>.html` (and optional `<base>.<styleLang>` styles).
 *
 * Styles can be authored in `.css`, `.scss`, or `.sass` — picked per project via
 * `options.styleLang` (so the loader pairs ONE extension, no filesystem probing) —
 * and are compiled to CSS before scoping.
 *
 * Two CSS delivery modes:
 *  - **build** (`dev: false`): scoped CSS is collected into `state.css` for the
 *    one-shot step to emit as a single stylesheet.
 *  - **dev** (`dev: true`): scoped CSS is appended to the component module as a
 *    tiny `<style>`-injecting IIFE, so nothing is written to disk (the dev server
 *    serves entirely from memory — `dist/` is a build-only artifact).
 *
 * A `.ts` without a sibling template is an ordinary module (the callback returns
 * `undefined`, so esbuild falls through to its default loader).
 */

import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compileComponent, parseSfc, extractSources, classifyTemplate, classifyStyle } from '@weave-framework/compiler';
import type { ComponentSource, ExtractedSources } from '@weave-framework/compiler';
import { compileStyleFileTracked, compileStyleSource, type StyleLang } from './styles.js';

export interface WeaveState {
  /** Scoped CSS collected from every component compiled this build (build mode only). */
  css: string[];
}

export interface WeaveOptions {
  /** Component style language — the sibling style file is `<base>.<styleLang>` (default `css`). */
  styleLang?: StyleLang;
  /** Dev mode: inject each component's CSS via JS instead of collecting it (default false). */
  dev?: boolean;
}

/** A `<style>`-injecting IIFE appended to a component module in dev mode. */
function cssInjector(css: string): string {
  if (!css) return '';
  return `\n;(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(
    css
  )};document.head.appendChild(s);})();\n`;
}

/**
 * Resolve a component's template to its source text. Precedence: a declared
 * `template` (inline markup, or a path-shaped value read from disk) wins; otherwise
 * the sibling `<base>.html`. Fails loud on ambiguity (declared + sibling) and on a
 * declared file that does not exist.
 */
async function resolveTemplate(
  decl: ExtractedSources,
  tsPath: string,
  siblingHtml: string,
  hasSiblingHtml: boolean
): Promise<{ text: string; files: string[] }> {
  if (decl.template !== undefined) {
    if (hasSiblingHtml) {
      throw new Error(
        `weave: ${tsPath} declares \`template\` and also has a sibling .html — remove one`
      );
    }
    if (classifyTemplate(decl.template) === 'inline') return { text: decl.template, files: [] };
    const file: string = resolve(dirname(tsPath), decl.template);
    if (!existsSync(file)) throw new Error(`weave: template file not found: ${file} (from ${tsPath})`);
    return { text: await readFile(file, 'utf8'), files: [file] };
  }
  return { text: await readFile(siblingHtml, 'utf8'), files: [siblingHtml] };
}

/**
 * Resolve a component's styles to one CSS string. Precedence: declared `styles`
 * (inline CSS and/or path-shaped files, compiled and concatenated in order) win;
 * otherwise the sibling `<base>.<styleLang>`; otherwise none. Fails loud on
 * ambiguity and on a declared file that does not exist.
 */
async function resolveStyles(
  decl: ExtractedSources,
  tsPath: string,
  dir: string,
  styleLang: StyleLang
): Promise<{ css: string | undefined; files: string[] }> {
  if (decl.styles !== undefined) {
    const siblingStyle: string = tsPath.replace(/\.ts$/, '.' + styleLang);
    if (existsSync(siblingStyle)) {
      throw new Error(
        `weave: ${tsPath} declares \`styles\` and also has a sibling .${styleLang} — remove one`
      );
    }
    const parts: string[] = [];
    const files: string[] = [];
    for (const entry of decl.styles) {
      if (classifyStyle(entry) === 'inline') {
        parts.push(await compileStyleSource(entry, styleLang, dir));
      } else {
        const file: string = resolve(dir, entry);
        if (!existsSync(file)) throw new Error(`weave: style file not found: ${file} (from ${tsPath})`);
        const compiled: { css: string; files: string[] } = await compileStyleFileTracked(file);
        parts.push(compiled.css);
        files.push(...compiled.files);
      }
    }
    return { css: parts.join('\n'), files };
  }
  const siblingStyle: string = tsPath.replace(/\.ts$/, '.' + styleLang);
  if (!existsSync(siblingStyle)) return { css: undefined, files: [] };
  const compiled: { css: string; files: string[] } = await compileStyleFileTracked(siblingStyle);
  return { css: compiled.css, files: compiled.files };
}

export function weave(state: WeaveState, options: WeaveOptions = {}): Plugin {
  const styleLang: StyleLang = options.styleLang ?? 'css';
  const dev: boolean = options.dev ?? false;

  /** Emit a compiled component: collect its CSS (build) or inject it (dev). */
  const emit = (code: string, css: string, resolveDir: string): OnLoadResult => {
    if (dev) return { contents: code + cssInjector(css), loader: 'ts' as const, resolveDir };
    if (css) state.css.push(css);
    return { contents: code, loader: 'ts' as const, resolveDir };
  };

  return {
    name: 'weave',
    setup(build: PluginBuild): void {
      build.onStart(() => {
        state.css.length = 0; // fresh collection each (re)build
      });

      build.onLoad({ filter: /\.weave$/ }, async (args: OnLoadArgs) => {
        const source: string = await readFile(args.path, 'utf8');
        const src: ComponentSource = parseSfc(source);
        const styles: string | undefined = src.styles
          ? await compileStyleSource(src.styles, styleLang, dirname(args.path))
          : undefined;
        const { code, css } = compileComponent({ ...src, styles }, { filename: args.path });
        return emit(code, css, dirname(args.path));
      });

      build.onLoad({ filter: /\.ts$/ }, async (args: OnLoadArgs) => {
        if (args.path.includes('node_modules')) return undefined;
        // Generated modules (`*.gen.ts`) are never components — and one like a docs
        // `content.gen.ts` (markdown bundled as strings) can contain the literal text
        // `export const template`/`styles` inside an example, which would otherwise be
        // mis-detected as a string-SFC component and compiled. Treat as an ordinary module.
        if (args.path.endsWith('.gen.ts')) return undefined;
        const source: string = await readFile(args.path, 'utf8');
        const decl: ExtractedSources = extractSources(source);

        const siblingHtml: string = args.path.replace(/\.ts$/, '.html');
        const hasSiblingHtml: boolean = existsSync(siblingHtml);
        // A `.ts` is a component iff it declares a template OR has a sibling `.html`.
        if (decl.template === undefined && !hasSiblingHtml) return undefined; // ordinary module

        const dir: string = dirname(args.path);
        const template: { text: string; files: string[] } = await resolveTemplate(
          decl,
          args.path,
          siblingHtml,
          hasSiblingHtml
        );
        const styles: { css: string | undefined; files: string[] } = await resolveStyles(
          decl,
          args.path,
          dir,
          styleLang
        );

        const { code, css } = compileComponent(
          { script: decl.script, template: template.text, styles: styles.css },
          { filename: args.path }
        );
        // Tell esbuild this module also depends on its template + style files, so a
        // template-only or style-only edit (which leaves the .ts untouched) still
        // triggers a watch-mode rebuild + live-reload.
        return { ...emit(code, css, dir), watchFiles: [...template.files, ...styles.files] };
      });
    },
  };
}
