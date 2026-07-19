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
import {
  createServer,
  request as httpRequest,
  type Server,
  type IncomingMessage,
  type ServerResponse,
  type ClientRequest,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, extname, relative, sep, isAbsolute } from 'node:path';
import { weave, type WeaveState } from './plugin.js';
import type { ProxyTable, ProxyRule } from './config.js';
import { entryPlugin, VIRTUAL_ENTRY } from './entry.js';
import { compileStyleFileWithAssets, type StyleAsset, type StyleLang } from './styles.js';
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
  /** Dev proxy: forward matching request paths to a backend so API calls stay same-origin. */
  proxy?: ProxyTable;
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

function mime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/* ──────────────────────────── dev proxy ──────────────────────────── */

/** A proxy rule with defaults resolved (shorthand expanded, `changeOrigin` filled in). */
interface NormalizedRule {
  target: string;
  changeOrigin: boolean;
  rewrite?: Record<string, string>;
}

/** Normalize a proxy table entry (string shorthand → full rule) with defaults filled in. */
function normalizeRule(entry: string | ProxyRule): NormalizedRule {
  const rule: ProxyRule = typeof entry === 'string' ? { target: entry } : entry;
  return { target: rule.target, changeOrigin: rule.changeOrigin ?? true, rewrite: rule.rewrite };
}

/**
 * First rule whose key matches `path` (query already stripped), or null. A key matches when
 * `path` equals it or starts with `key + '/'` — so `/api` matches `/api` and `/api/x` (and
 * `/api?q=1`, since `path` is query-stripped) but NOT `/apiary`. Insertion order wins.
 */
function matchProxy(path: string, table: ProxyTable): string | ProxyRule | null {
  for (const key of Object.keys(table)) {
    if (path === key || path.startsWith(key + '/')) return table[key];
  }
  return null;
}

/**
 * Forward one request to a backend and pipe the response back unchanged. Streams the body
 * (so POST payloads and cookies pass through both ways); a `rewrite` is applied to the PATH
 * only (the query is preserved). An unreachable backend → 502, never a dev-server crash.
 */
function proxyRequest(req: IncomingMessage, res: ServerResponse, entry: string | ProxyRule): void {
  const rule: NormalizedRule = normalizeRule(entry);
  const target: URL = new URL(rule.target);

  // Split the full URL into path + query; rewrite the path, keep the query verbatim.
  const raw: string = req.url ?? '/';
  const q: number = raw.indexOf('?');
  let path: string = q === -1 ? raw : raw.slice(0, q);
  const query: string = q === -1 ? '' : raw.slice(q);
  if (rule.rewrite) {
    for (const [source, replacement] of Object.entries(rule.rewrite)) {
      path = path.replace(new RegExp(source), replacement);
    }
  }

  const headers: IncomingMessage['headers'] = { ...req.headers };
  if (rule.changeOrigin) headers.host = target.host;

  const send: typeof httpRequest = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxied: ClientRequest = send(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: path + query,
      headers,
    },
    (backendRes: IncomingMessage): void => {
      res.writeHead(backendRes.statusCode ?? 502, backendRes.headers);
      backendRes.pipe(res);
    }
  );
  proxied.on('error', (err: Error): void => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`weave dev proxy: could not reach ${rule.target} — ${err.message}`);
  });
  req.pipe(proxied);
}

export async function dev(config: DevConfig): Promise<DevServer> {
  return (config.inMemory ?? false) ? devInMemory(config) : devLegacy(config);
}

/* ──────────────────────────── in-memory (config) ──────────────────────────── */

async function devInMemory(config: DevConfig): Promise<DevServer> {
  const state: WeaveState = { css: [] };

  // Global entry styles → a JS banner that injects them as one <style> (compiled once).
  // Their url() assets (fonts, images) are rewritten to /assets/… and served from `assetMap`.
  const assetMap: Map<string, string> = new Map(); // '/assets/…' → absolute source path
  let banner: { js: string } | undefined;
  if (config.styles?.length) {
    const compiled: Array<{ css: string; assets: StyleAsset[] }> = await Promise.all(
      config.styles.map(compileStyleFileWithAssets)
    );
    const css: string = compiled.map((s) => s.css).join('\n');
    for (const asset of compiled.flatMap((s) => s.assets)) assetMap.set('/' + asset.servedPath, asset.absPath);
    if (css)
      // Guard by a fixed id: if this banner is evaluated more than once (e.g. bundled into
      // a lazily-loaded route chunk on SPA navigation), it would otherwise append a duplicate
      // copy of the entire global stylesheet every time — the head balloons with identical
      // ~100KB sheets and style recalc/devtools grind. Idempotent injection fixes that.
      banner = {
        js: `(()=>{const id="w-global-styles";if(document.getElementById(id))return;const s=document.createElement("style");s.id=id;s.textContent=${JSON.stringify(
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
        // A FAILED build has no output files. Clearing and repopulating from that empty list wiped the
        // served bundle, and the unconditional reload below then sent the browser to a `/main.js` that
        // no longer existed — a white page, with the real error visible only in the terminal. On a syntax
        // error, the most common event in a dev loop, the tool erased the evidence.
        //
        // Keep the last GOOD outputs and push the error instead: the page stays as it was, with an overlay
        // naming the failure. The next successful build swaps the outputs and reloads, clearing it.
        if (result.errors.length > 0) {
          const text: string = result.errors
            .map((e) => {
              const at: string = e.location ? ` (${e.location.file}:${e.location.line}:${e.location.column})` : '';
              return `${e.text}${at}`;
            })
            .join('\n\n');
          for (const res of clients) res.write(`data: error:${encodeURIComponent(text)}\n\n`);
          return;
        }
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
    // Inline maps so a breakpoint lands in the author's .ts/.html instead of the bundled output. Inline
    // rather than linked because dev serves from memory: a separate .map file would need its own route.
    sourcemap: 'inline',
    banner,
    plugins: [
      weave(state, { styleLang: config.styleLang, dev: true }),
      ...(ve ? [entryPlugin(ve.code, ve.resolveDir)] : []),
      capture,
    ],
  });
  await ctx.watch();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res, config, outputs, clients, assetMap);
  });
  const port: number = await listen(server, config.port);
  return { ctx, url: `http://127.0.0.1:${port}` };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: DevConfig,
  outputs: Map<string, Uint8Array>,
  clients: Set<ServerResponse>,
  assetMap: Map<string, string> = new Map()
): Promise<void> {
  const url: string = (req.url ?? '/').split('?')[0];

  // Dev proxy: forward matching paths to a backend so the app's API calls stay same-origin
  // (no CORS, cookie auth just works). Runs FIRST — before SSE, build outputs, static, and
  // the SPA shell — so a configured prefix (e.g. `/api`) always wins. App prefixes don't
  // collide with `/__weave_reload` or `/main.js`.
  if (config.proxy) {
    const rule: string | ProxyRule | null = matchProxy(url, config.proxy);
    if (rule) {
      proxyRequest(req, res, rule);
      return;
    }
  }

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

  // A url() asset from a global stylesheet (font/image) — rewritten to /assets/… and served
  // from its original on-disk location, so self-hosted webfonts load (no 404, no fallback).
  const assetSrc: string | undefined = assetMap.get(url);
  if (assetSrc) {
    try {
      const buf: Buffer = await readFile(assetSrc);
      res.writeHead(200, { 'content-type': mime(url) });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // A real asset path → static file from publicDir (favicons, manifest, …).
  if (extname(url)) {
    // Guard against path traversal: the resolved file must stay inside servedir
    // (a raw request like `/../../etc/passwd` must not escape the served root).
    const target: string = join(config.servedir, url);
    const rel: string = relative(config.servedir, target);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const buf: Buffer = await readFile(target);
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
