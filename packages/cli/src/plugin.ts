/**
 * The Weave esbuild plugin — the canonical loader (the inlined copy in
 * `tools/verify-build.mjs` mirrors this). Compiles two authoring forms into one
 * ES module each, collecting every component's scoped CSS into `state.css` for
 * the build/dev step to emit as one stylesheet:
 *
 *  - `.weave` SFC (split by `parseSfc`)
 *  - separate files (Angular-style): a `.ts` with a co-located `<base>.html`
 *    (and optional `<base>.css`) — the default authoring model.
 *
 * A `.ts` without a sibling `.html` is an ordinary module (the callback returns
 * `undefined`, so esbuild falls through to its default loader).
 */

import type { Plugin } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { compileComponent, parseSfc } from '@weave/compiler';

export interface WeaveState {
  /** Scoped CSS collected from every component compiled this build. */
  css: string[];
}

export function weave(state: WeaveState): Plugin {
  return {
    name: 'weave',
    setup(build) {
      build.onStart(() => {
        state.css.length = 0; // fresh collection each (re)build
      });

      build.onLoad({ filter: /\.weave$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const { code, css } = compileComponent(parseSfc(source), { filename: args.path });
        if (css) state.css.push(css);
        return { contents: code, loader: 'ts', resolveDir: dirname(args.path) };
      });

      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        if (args.path.includes('node_modules')) return undefined;
        const template = args.path.replace(/\.ts$/, '.html');
        if (!existsSync(template)) return undefined; // ordinary module
        const stylePath = args.path.replace(/\.ts$/, '.css');
        const { code, css } = compileComponent(
          {
            script: await readFile(args.path, 'utf8'),
            template: await readFile(template, 'utf8'),
            styles: existsSync(stylePath) ? await readFile(stylePath, 'utf8') : undefined,
          },
          { filename: args.path }
        );
        if (css) state.css.push(css);
        return { contents: code, loader: 'ts', resolveDir: dirname(args.path) };
      });
    },
  };
}
