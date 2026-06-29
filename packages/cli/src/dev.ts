/**
 * `weave dev` — watch + rebuild + serve with live-reload. Uses esbuild's serve
 * (the cross-origin dev-server advisory GHSA-67mh-4wv8-2f99 is fixed in
 * esbuild ≥ 0.25). The served `index.html` opts into reload via:
 *   new EventSource('/esbuild').addEventListener('change', () => location.reload())
 *
 * Two modes:
 *  - **legacy** (flag-driven): scoped CSS is written to `outdir/app.css` and the
 *    static `servedir` (which may equal `outdir`) is served.
 *  - **in-memory** (config-driven): NOTHING is written to disk — component CSS is
 *    injected via JS by the plugin, global entry styles ride a JS banner, and the
 *    bundle is served from memory. `dist/` stays a build-only artifact.
 *
 * Returns the build context so a caller (or test) can dispose it; the CLI keeps
 * it running.
 */

import { context, type BuildContext, type Plugin } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { weave, type WeaveState } from './plugin.js';
import { compileStyleFile, type StyleLang } from './styles.js';

export interface DevConfig {
  entry: string;
  servedir: string;
  outdir: string;
  port?: number;
  styleLang?: StyleLang;
  /** Global entry stylesheets (absolute paths) — injected via a JS banner in memory. */
  styles?: string[];
  /** In-memory mode: write nothing to disk (config-driven). Default false (legacy). */
  inMemory?: boolean;
}

export interface DevServer {
  ctx: BuildContext;
  url: string;
}

export async function dev(config: DevConfig): Promise<DevServer> {
  const state: WeaveState = { css: [] };
  const inMemory = config.inMemory ?? false;

  // In-memory mode: global styles ride a banner that injects them as one <style>.
  let banner: { js: string } | undefined;
  if (inMemory && config.styles?.length) {
    const css = (await Promise.all(config.styles.map(compileStyleFile))).join('\n');
    if (css)
      banner = {
        js: `(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(
          css
        )};document.head.appendChild(s);})();`,
      };
  }

  // Legacy mode keeps writing the collected stylesheet to disk; in-memory writes nothing.
  const plugins: Plugin[] = [weave(state, { styleLang: config.styleLang, dev: inMemory })];
  if (!inMemory) {
    plugins.push({
      name: 'weave:css',
      setup(build) {
        build.onEnd(async () => {
          await mkdir(config.outdir, { recursive: true });
          await writeFile(join(config.outdir, 'app.css'), state.css.join('\n'));
        });
      },
    });
  }

  const ctx = await context({
    entryPoints: [config.entry],
    bundle: true,
    format: 'esm',
    // Split dynamic import()s into chunks so `lazy()` routes load on demand and
    // <Link> prefetch (B.15) can warm them.
    splitting: true,
    outdir: config.outdir,
    // In-memory mode keeps every output in memory (served, never written) so the dev
    // server creates no `dist/` — `src` and `dist` stay separate worlds.
    write: !inMemory,
    banner,
    plugins,
  });
  await ctx.watch();
  // Bind to loopback only — a dev server should not be exposed on the LAN.
  // `fallback` serves index.html for any unmatched path so client-side routes
  // (e.g. /task/42) survive a refresh / direct link / back-forward instead of 404ing.
  const { hosts, port } = await ctx.serve({
    servedir: config.servedir,
    fallback: join(config.servedir, 'index.html'),
    port: config.port,
    host: '127.0.0.1',
  });
  const url = `http://${hosts[0] ?? '127.0.0.1'}:${port}`;
  return { ctx, url };
}
