/**
 * Serves the built docs (docs/dist) like GitHub Pages would: static files, with a
 * 404.html SPA fallback for unknown paths. For previewing the production build
 * locally before deploy. `node docs/tools/serve-dist.mjs` → http://localhost:8200
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8200;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, rel);
  try {
    if (url.endsWith('/')) file = join(dist, rel, 'index.html');
    let body = await readFile(file).catch(() => null);
    if (body === null && !extname(file)) {
      // Unknown route, no extension → SPA fallback (what Pages does with 404.html).
      body = await readFile(join(dist, '404.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(body);
      return;
    }
    if (body === null) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end('Server error');
  }
}).listen(port, () => console.log(`serve-dist → http://localhost:${port}`));
