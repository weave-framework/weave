/**
 * The local service behind `weave migrate` — a web UI instead of a terminal dialogue.
 *
 * It is local in the strong sense, not by convention: the listener binds `127.0.0.1`, so the service is
 * unreachable from the network by construction rather than by a setting somebody can get wrong. That matters more
 * here than in a dev server, because this process reads directories anywhere on the machine and answers with what
 * it found.
 *
 * Which is also why a browser page from ANOTHER origin must not be able to talk to it. A page on any website can
 * POST to `http://127.0.0.1:<port>` — it cannot read a cross-origin response, but a request that makes the server
 * *act* is enough to matter, and `fetch` with `mode: 'no-cors'` sends it happily. Two guards, both cheap:
 *
 *  - **A session token.** Generated per run, carried in the URL that gets printed, required on every `/api/*`
 *    call. Another origin cannot guess it and cannot read it out of our page.
 *  - **An origin check.** A cross-origin `Origin` header is refused outright, so the token never even gets tested.
 *
 * Neither is a substitute for the other: the token survives a browser that omits `Origin`, and the origin check
 * catches a stale link someone pasted into a chat.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { inspect, type Workspace } from './detect.js';

/** A running migration service. */
export interface MigrateServer {
  /** The URL to open, token included. This is the string the command prints. */
  url: string;
  /** The port actually bound — not always the one requested. */
  port: number;
  /** The session token every `/api/*` request must carry. */
  token: string;
  /** Stop listening. Resolves once the port is free. */
  close(): Promise<void>;
}

/** Options for {@link serve}. Every one has a working default. */
export interface ServeOptions {
  /** Preferred port. Taken ports step forward; omit for any free port. */
  port?: number;
  /** Directory holding the built UI. When it does not exist, the service still answers `/api/*`. */
  uiDir?: string;
}

/** How many ports past the requested one to try before giving up — the same budget `weave dev` uses. */
const PORT_ATTEMPTS: number = 20;

/** Largest request body accepted, in bytes. A path is short; anything larger is not a path. */
const MAX_BODY: number = 64 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Content type for a served file, defaulting to bytes rather than guessing text. */
function mime(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Write a JSON response. Every API answer goes through here, so the headers stay identical. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const text: string = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // The service answers only its own page. Saying so explicitly costs nothing and removes any doubt about
    // whether some default made it readable elsewhere.
    'access-control-allow-origin': 'null',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

/**
 * Is this request allowed to reach the API?
 *
 * A same-origin `fetch` from our own page sends `Origin: http://127.0.0.1:<port>`, which matches `Host`. A page
 * on another site sends its own origin, which does not. A request with no `Origin` at all (curl, a test) is
 * allowed through to the token check — the token is what protects that path.
 */
function originAllowed(req: IncomingMessage): boolean {
  const origin: string | undefined = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** What reading a request body produced: the text, or the reason there is none. */
type BodyResult = { ok: true; text: string } | { ok: false; reason: 'too-large' | 'stream-error' };

/**
 * Read a request body, stopping at {@link MAX_BODY} rather than buffering whatever arrives.
 *
 * It resolves — it does not destroy the socket. Destroying on the oversize branch tore the connection down
 * before the 413 could be written, so the caller saw `ECONNRESET`: a network failure where the truth was "your
 * body is too big", which is the difference between a bug the user can act on and one they cannot. The caller
 * answers first; hanging up is its decision, after the response is out.
 *
 * Past the limit the chunks are dropped and the stream is drained instead of parsed, so an oversized request
 * costs a read, not memory.
 */
function readBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve: (r: BodyResult) => void): void => {
    const chunks: Buffer[] = [];
    let size: number = 0;
    let over: boolean = false;

    req.on('data', (c: Buffer): void => {
      size += c.length;
      if (over) return;
      if (size > MAX_BODY) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', (): void => resolve(over ? { ok: false, reason: 'too-large' } : { ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', (): void => resolve({ ok: false, reason: 'stream-error' }));
  });
}

/**
 * Serve one file out of `uiDir`, refusing any path that resolves outside it.
 *
 * The path is percent-decoded first, because a built asset may legitimately carry a space or a plus in its name
 * and would otherwise be looked up under its escaped spelling and never found. Decoding is also what makes the
 * containment check below load-bearing rather than decorative: `new URL` already collapses `/../..`, and even
 * `/%2e%2e/%2e%2e`, before this function ever sees them — but it leaves `%2f` alone, so `..%2f..%2f` arrives
 * intact and turns into `../../` the moment it is decoded. Decode, then verify.
 */
async function serveStatic(res: ServerResponse, uiDir: string, pathname: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape (`%zz`) is not a path this service can look up, and guessing at it would be worse.
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const rel: string = decoded === '/' ? 'index.html' : decoded.slice(1);
  const target: string = join(uiDir, rel);
  const inside: string = relative(uiDir, target);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const buf: Buffer = await readFile(target);
    res.writeHead(200, { 'content-type': mime(target), 'x-content-type-options': 'nosniff' });
    res.end(buf);
  } catch {
    // A single-page app owns its routes, so an unknown path is the shell, not a 404 — but only when the shell
    // is actually there. Without a built UI, saying "not found" is the truth.
    const shell: string = join(uiDir, 'index.html');
    if (existsSync(shell)) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(await readFile(shell));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }
}

/** Bind the server, stepping past a busy port the way `weave dev` does rather than crashing on EADDRINUSE. */
function listen(server: Server, port?: number): Promise<number> {
  return new Promise((resolve: (p: number) => void, reject: (e: Error) => void): void => {
    let attempt: number = port ?? 0;
    let tried: number = 0;

    server.on('error', (err: NodeJS.ErrnoException): void => {
      // Port 0 means "any free port", so it cannot be in use — a failure there is real.
      if (err.code === 'EADDRINUSE' && attempt !== 0 && tried < PORT_ATTEMPTS) {
        tried++;
        attempt += 1;
        server.listen(attempt, '127.0.0.1');
        return;
      }
      reject(err);
    });
    server.on('listening', (): void => {
      const addr: string | { port: number } | null = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : attempt);
    });
    server.listen(attempt, '127.0.0.1');
  });
}

/**
 * Start the migration service.
 *
 * Nothing is written by this process: the API reads directories and answers with what it found. The one route
 * that exists so far, `POST /api/inspect`, takes `{ path }` and returns the {@link Workspace} — the same object
 * the first screen renders.
 */
export async function serve(options: ServeOptions = {}): Promise<MigrateServer> {
  const token: string = randomBytes(24).toString('hex');
  const uiDir: string | undefined = options.uiDir;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    void handle(req, res);
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url: URL = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    if (!url.pathname.startsWith('/api/')) {
      if (!uiDir) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('The migration UI is not built yet. The API is up.');
        return;
      }
      await serveStatic(res, uiDir, url.pathname);
      return;
    }

    if (!originAllowed(req)) {
      json(res, 403, { error: 'cross-origin request refused' });
      return;
    }
    const given: string | null = url.searchParams.get('token') ?? req.headers['x-migrate-token']?.toString() ?? null;
    if (given !== token) {
      json(res, 403, { error: 'bad or missing session token' });
      return;
    }

    if (url.pathname === '/api/inspect' && req.method === 'POST') {
      const body: BodyResult = await readBody(req);
      if (!body.ok) {
        json(res, body.reason === 'too-large' ? 413 : 400, {
          error: body.reason === 'too-large' ? 'request body too large' : 'could not read the request body',
        });
        return;
      }
      let path: unknown;
      try {
        path = (JSON.parse(body.text) as { path?: unknown }).path;
      } catch {
        json(res, 400, { error: 'body must be JSON' });
        return;
      }
      if (typeof path !== 'string' || !path.trim()) {
        json(res, 400, { error: 'give a path to inspect' });
        return;
      }
      if (!existsSync(path)) {
        // Name the path back. Without it, a stray character looks exactly like a mistyped folder, and the
        // reader has no way to tell the two apart — a lesson the terminal version already learned.
        json(res, 404, { error: `nothing at ${path}` });
        return;
      }
      const found: Workspace = inspect(path);
      json(res, 200, found);
      return;
    }

    json(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  };

  const port: number = await listen(server, options.port);
  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: (): Promise<void> =>
      new Promise((resolve: () => void): void => {
        server.close((): void => resolve());
      }),
  };
}
