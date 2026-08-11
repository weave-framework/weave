/**
 * Serves the built docs (docs/dist) the way the site is actually hosted: Cloudflare static
 * assets — a file if there is one, else `<path>/index.html`, else the SPA fallback. For
 * previewing the production build locally before deploy.
 * `node docs/tools/serve-dist.mjs` → http://localhost:8200
 *
 * It used to mimic GitHub Pages, which is where the docs lived before Cloudflare. The
 * difference is not cosmetic: Pages has no directory-index step, so a prerendered `--ssg`
 * route was served by the SPA fallback here and looked identical to the SPA build.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8200;
// Mimic a project sub-path host (user.github.io/weave/) when DOCS_BASE is set.
let base = (process.env.DOCS_BASE || '/').replace(/\/+$/, '');
if (base === '/') base = '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  // Strip the sub-path base so /weave/main.js resolves to dist/main.js.
  if (base && (url === base || url.startsWith(base + '/'))) url = url.slice(base.length) || '/';
  const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, rel);
  try {
    if (url.endsWith('/')) file = join(dist, rel, 'index.html');
    let body = await readFile(file).catch(() => null);
    // Cloudflare's static assets try `<path>/index.html` before falling back
    // (`html_handling: auto-trailing-slash`, its default). That is what serves a prerendered
    // `--ssg` route: /learn/templates is a DIRECTORY holding index.html, not a missing file.
    // Without this the preview answers such a path with the SPA fallback — which happens to
    // render the same page, so the one thing SSG changes would be invisible here.
    if (body === null && !extname(file)) {
      body = await readFile(join(dist, rel, 'index.html')).catch(() => null);
      if (body !== null) file = join(dist, rel, 'index.html');
    }
    if (body === null && !extname(file)) {
      // Nothing prerendered there → the SPA fallback (`not_found_handling`, wrangler.toml).
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
