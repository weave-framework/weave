/**
 * `weave dev` — watch + rebuild + serve with live-reload. Uses esbuild's serve
 * (the cross-origin dev-server advisory GHSA-67mh-4wv8-2f99 is fixed in
 * esbuild ≥ 0.25). The served `index.html` opts into reload via:
 *   new EventSource('/esbuild').addEventListener('change', () => location.reload())
 *
 * Returns the build context so a caller (or test) can dispose it; the CLI keeps
 * it running.
 */

import { context, type BuildContext } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { weave, type WeaveState } from './plugin.js';

export interface DevConfig {
  entry: string;
  servedir: string;
  outdir: string;
  port?: number;
}

export interface DevServer {
  ctx: BuildContext;
  url: string;
}

export async function dev(config: DevConfig): Promise<DevServer> {
  const state: WeaveState = { css: [] };
  const ctx = await context({
    entryPoints: [config.entry],
    bundle: true,
    format: 'esm',
    // Split dynamic import()s into chunks so `lazy()` routes load on demand and
    // <Link> prefetch (B.15) can warm them.
    splitting: true,
    outdir: config.outdir,
    plugins: [
      weave(state),
      {
        name: 'weave:css',
        setup(build) {
          build.onEnd(async () => {
            await mkdir(config.outdir, { recursive: true });
            await writeFile(join(config.outdir, 'app.css'), state.css.join('\n'));
          });
        },
      },
    ],
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
