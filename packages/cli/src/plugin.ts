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

import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { compileComponent, parseSfc } from '@weave/compiler';
import { compileStyleFile, compileStyleSource, type StyleLang } from './styles.js';

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

export function weave(state: WeaveState, options: WeaveOptions = {}): Plugin {
  const styleLang: StyleLang = options.styleLang ?? 'css';
  const dev = options.dev ?? false;

  /** Emit a compiled component: collect its CSS (build) or inject it (dev). */
  const emit = (code: string, css: string, resolveDir: string) => {
    if (dev) return { contents: code + cssInjector(css), loader: 'ts' as const, resolveDir };
    if (css) state.css.push(css);
    return { contents: code, loader: 'ts' as const, resolveDir };
  };

  return {
    name: 'weave',
    setup(build) {
      build.onStart(() => {
        state.css.length = 0; // fresh collection each (re)build
      });

      build.onLoad({ filter: /\.weave$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const src = parseSfc(source);
        const styles = src.styles
          ? await compileStyleSource(src.styles, styleLang, dirname(args.path))
          : undefined;
        const { code, css } = compileComponent({ ...src, styles }, { filename: args.path });
        return emit(code, css, dirname(args.path));
      });

      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        if (args.path.includes('node_modules')) return undefined;
        const template = args.path.replace(/\.ts$/, '.html');
        if (!existsSync(template)) return undefined; // ordinary module
        const stylePath = args.path.replace(/\.ts$/, '.' + styleLang);
        const { code, css } = compileComponent(
          {
            script: await readFile(args.path, 'utf8'),
            template: await readFile(template, 'utf8'),
            styles: existsSync(stylePath) ? await compileStyleFile(stylePath) : undefined,
          },
          { filename: args.path }
        );
        return emit(code, css, dirname(args.path));
      });
    },
  };
}
