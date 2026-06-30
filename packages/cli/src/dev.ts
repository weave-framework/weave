/**
 * `weave dev` — watch + rebuild + serve with live-reload. Two modes:
 *
 *  - **in-memory** (config-driven): Weave runs its OWN dev server. The author's
 *    `index.html` is a clean shell — the framework injects the entry `<script>` and
 *    the live-reload client itself (so a developer never writes or forgets that
 *    boilerplate). Nothing is written to disk: the JS bundle is served from memory,
 *    component CSS self-injects, global styles ride a JS banner, and static assets
 *    (favicons, manifest) come from `publicDir`. Unmatched routes fall back to the
 *    injected shell so client routes survive a refresh.
 *
 *  - **legacy** (flag-driven): esbuild's own serve over a static `servedir`, writing
 *    the collected stylesheet to `outdir/app.css`. Kept for `examples/__fixtures__/v2` + verify.
 *
 * Returns the build context so a caller (or test) can dispose it; the CLI keeps it running.
 */

import { context, type BuildContext, type Plugin, type PluginBuild, type BuildResult } from 'esbuild';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';
import { weave, type WeaveState } from './plugin.js';
import { entryPlugin, VIRTUAL_ENTRY } from './entry.js';
import { compileStyleFile, type StyleLang } from './styles.js';
import { injectHtml } from './html.js';

export interface DevConfig {
  /** Hand-written entry module (absolute). Mutually exclusive with {@link virtualEntry}. */
  entry?: string;
  /** Framework-generated entry (Level C): the module source + the dir its imports resolve against. */
  virtualEntry?: { code: string; resolveDir: string };
  servedir: string;
  outdir: string;
  port?: number;
  styleLang?: StyleLang;
  /** Global entry stylesheets (absolute paths) — injected via a JS banner in memory. */
  styles?: string[];
  /** HTML shell to inject + serve (in-memory mode). */
  index?: string;
  /** In-memory mode: write nothing to disk, run Weave's own dev server. Default false (legacy). */
  inMemory?: boolean;
}

export interface DevServer {
  ctx: BuildContext;
  url: string;
}

/** The live-reload SSE endpoint Weave's dev server exposes (and the injected client connects to). */
const RELOAD_PATH: string = '/__weave_reload';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export async function dev(config: DevConfig): Promise<DevServer> {
  return (config.inMemory ?? false) ? devInMemory(config) : devLegacy(config);
}

/* ──────────────────────────── in-memory (config) ──────────────────────────── */

async function devInMemory(config: DevConfig): Promise<DevServer> {
  const state: WeaveState = { css: [] };

  // Global entry styles → a JS banner that injects them as one <style> (compiled once).
  let banner: { js: string } | undefined;
  if (config.styles?.length) {
    const css: string = (await Promise.all(config.styles.map(compileStyleFile))).join('\n');
    if (css)
      banner = {
        js: `(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(
          css
        )};document.head.appendChild(s);})();`,
      };
  }

  // In-memory build outputs ('/main.js' → bytes) + connected live-reload clients.
  const outputs: Map<string, Uint8Array> = new Map();
  const clients: Set<ServerResponse> = new Set();

  const capture: Plugin = {
    name: 'weave:dev-capture',
    setup(build: PluginBuild): void {
      build.onEnd((result: BuildResult): void => {
        outputs.clear();
        for (const file of result.outputFiles ?? []) {
          const rel: string = relative(config.outdir, file.path).split(sep).join('/');
          outputs.set('/' + rel, file.contents);
        }
        for (const res of clients) res.write('data: reload\n\n'); // tell every client to reload
      });
    },
  };

  const ve: { code: string; resolveDir: string } | undefined = config.virtualEntry;
  const ctx: BuildContext = await context({
    entryPoints: ve ? [{ in: VIRTUAL_ENTRY, out: 'main' }] : [config.entry!],
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: config.outdir,
    write: false, // everything stays in memory — dev creates no dist/
    banner,
    plugins: [
      weave(state, { styleLang: config.styleLang, dev: true }),
      ...(ve ? [entryPlugin(ve.code, ve.resolveDir)] : []),
      capture,
    ],
  });
  await ctx.watch();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res, config, outputs, clients);
  });
  const port: number = await listen(server, config.port);
  return { ctx, url: `http://127.0.0.1:${port}` };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: DevConfig,
  outputs: Map<string, Uint8Array>,
  clients: Set<ServerResponse>
): Promise<void> {
  const url: string = (req.url ?? '/').split('?')[0];

  // Live-reload SSE: hold the connection open; `capture` pushes 'reload' on rebuild.
  if (url === RELOAD_PATH) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', (): void => {
      clients.delete(res);
    });
    return;
  }

  // In-memory build output (main.js, chunk-*.js).
  const built: Uint8Array | undefined = outputs.get(url);
  if (built) {
    res.writeHead(200, { 'content-type': mime(url) });
    res.end(Buffer.from(built));
    return;
  }

  // A real asset path → static file from publicDir (favicons, manifest, …).
  if (extname(url)) {
    try {
      const buf: Buffer = await readFile(join(config.servedir, url));
      res.writeHead(200, { 'content-type': mime(url) });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // No extension → a client route: serve the injected shell (SPA fallback).
  try {
    const shell: string = config.index ?? join(config.servedir, 'index.html');
    const html: string = injectHtml(await readFile(shell, 'utf8'), {
      script: '/main.js',
      liveReload: RELOAD_PATH,
    });
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end('No index.html');
  }
}

function listen(server: Server, port?: number): Promise<number> {
  return new Promise((resolve: (port: number) => void): void => {
    server.listen(port ?? 0, '127.0.0.1', (): void => {
      const addr: AddressInfo | string | null = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : (port ?? 0));
    });
  });
}

/* ──────────────────────────── legacy (flags) ──────────────────────────── */

async function devLegacy(config: DevConfig): Promise<DevServer> {
  const state: WeaveState = { css: [] };
  const plugins: Plugin[] = [
    weave(state, { styleLang: config.styleLang }),
    {
      name: 'weave:css',
      setup(build: PluginBuild): void {
        build.onEnd(async (): Promise<void> => {
          await mkdir(config.outdir, { recursive: true });
          await writeFile(join(config.outdir, 'app.css'), state.css.join('\n'));
        });
      },
    },
  ];

  const ctx: BuildContext = await context({
    entryPoints: [config.entry!], // legacy mode always has a hand-written entry
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: config.outdir,
    plugins,
  });
  await ctx.watch();
  // Bind to loopback only; `fallback` serves index.html for unmatched client routes.
  const { hosts, port } = await ctx.serve({
    servedir: config.servedir,
    fallback: join(config.servedir, 'index.html'),
    port: config.port,
    host: '127.0.0.1',
  });
  return { ctx, url: `http://${hosts[0] ?? '127.0.0.1'}:${port}` };
}
