/**
 * Weave app config (Angular-style) — one file declares everything the build/dev
 * pipeline needs: the entry module, the HTML shell, the output dir, the global
 * entry stylesheets, and the component style language. The CLI reads it instead
 * of long `--out`/`--serve` flags.
 *
 * A `weave.config.ts` is compiled on the fly with esbuild (the `@weave/cli` import
 * is shimmed to a tiny `defineConfig` identity, so nothing heavy is pulled in) and
 * imported via a `data:` URL — no temp file. A `weave.config.json` is parsed directly.
 */

import { build as esbuildBuild } from 'esbuild';
import type { BuildResult, PluginBuild } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import type { StyleLang } from './styles.js';

export interface WeaveConfig {
  /**
   * Root component module (relative to the config file). When set, the framework
   * OWNS the bootstrap: it generates the entry (import root, auto-register custom
   * elements, mount) — no hand-written `main.ts`. Mutually exclusive with `entry`.
   */
  root?: string;
  /** Mount target for the generated bootstrap — a CSS selector (default `#app`). Only with `root`. */
  mount?: string;
  /** App entry module (relative to the config file). The escape hatch when you want a hand-written bootstrap. */
  entry?: string;
  /** Static web root — served as-is in dev and copied verbatim into the build output. */
  publicDir?: string;
  /** HTML shell template (relative to the config file). */
  index?: string;
  /** Output directory for `weave build` (default `dist`). */
  outDir?: string;
  /** Component style language — the loader pairs `<base>.<styleLang>`, no probing (default `css`). */
  styleLang?: StyleLang;
  /** Global entry stylesheets, compiled + concatenated in order (first = base). */
  styles?: string[];
  dev?: { port?: number };
  build?: { minify?: boolean };
}

/** Identity helper so a `weave.config.ts` gets full type-checking + inference. */
export function defineConfig(config: WeaveConfig): WeaveConfig {
  return config;
}

/** A {@link WeaveConfig} with every path made absolute and defaults filled in. */
export interface ResolvedConfig {
  /** Directory containing the config. */
  root: string;
  /** App entry (absolute) — set when the author hand-writes the bootstrap. */
  entry?: string;
  /** Root component (absolute) — set when the framework generates the bootstrap. */
  rootComponent?: string;
  /** Mount selector for the generated bootstrap. */
  mount: string;
  /** Static web root (absolute) — defaults to {@link root} when no `publicDir` is set. */
  publicDir: string;
  index?: string;
  outDir: string;
  styleLang: StyleLang;
  styles: string[];
  port?: number;
  minify: boolean;
}

const CONFIG_NAMES: string[] = ['weave.config.ts', 'weave.config.js', 'weave.config.mjs', 'weave.config.json'];

/** Find + load a Weave config from `cwd` (or an explicit path). Returns null if none exists. */
export async function loadConfig(cwd: string, explicit?: string): Promise<ResolvedConfig | null> {
  const file: string | undefined = explicit
    ? resolve(cwd, explicit)
    : CONFIG_NAMES.map((n) => join(cwd, n)).find((p) => existsSync(p));
  if (!file || !existsSync(file)) return null;

  const raw: WeaveConfig = file.endsWith('.json')
    ? JSON.parse(await readFile(file, 'utf8'))
    : await importConfigModule(file);

  return resolveConfig(raw, dirname(file));
}

/** Compile a TS/JS config to one ESM string and import it via a `data:` URL. */
async function importConfigModule(file: string): Promise<WeaveConfig> {
  const out: BuildResult = await esbuildBuild({
    entryPoints: [file],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    packages: 'external', // keep node_modules external (resolved at import time)
    plugins: [
      {
        // `import { defineConfig } from '@weave/cli'` → a tiny inline identity, so
        // the config doesn't drag the whole CLI (and esbuild) into the bundle.
        name: 'weave-config-shim',
        setup(b: PluginBuild): void {
          b.onResolve({ filter: /^@weave\/cli$/ }, () => ({
            path: '@weave/cli',
            namespace: 'weave-cli-shim',
          }));
          b.onLoad({ filter: /.*/, namespace: 'weave-cli-shim' }, () => ({
            contents: 'export const defineConfig = (c) => c;',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const code: string = out.outputFiles![0].text;
  const url: string = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const mod: { default?: WeaveConfig } & WeaveConfig = (await import(url)) as {
    default?: WeaveConfig;
  } & WeaveConfig;
  return (mod.default ?? mod) as WeaveConfig;
}

function resolveConfig(raw: WeaveConfig, root: string): ResolvedConfig {
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(root, p));
  if (!raw.root && !raw.entry) {
    throw new Error('weave: config must declare either `root` (generated bootstrap) or `entry` (hand-written)');
  }
  if (raw.root && raw.entry) {
    throw new Error('weave: config declares both `root` and `entry` — pick one');
  }
  return {
    root,
    entry: raw.entry ? abs(raw.entry) : undefined,
    rootComponent: raw.root ? abs(raw.root) : undefined,
    mount: raw.mount ?? '#app',
    publicDir: raw.publicDir ? abs(raw.publicDir) : root,
    index: raw.index ? abs(raw.index) : undefined,
    outDir: abs(raw.outDir ?? 'dist'),
    styleLang: raw.styleLang ?? 'css',
    styles: (raw.styles ?? []).map(abs),
    port: raw.dev?.port,
    minify: raw.build?.minify ?? true,
  };
}
