/**
 * Post-build for GitHub Pages:
 *  - 404.html = a copy of index.html, so deep links (e.g. /learn/signals) boot the
 *    SPA instead of 404'ing (Pages serves 404.html for unknown paths).
 *  - .nojekyll so Pages serves files/dirs starting with `_` and skips Jekyll.
 *  - When DOCS_BASE is set (e.g. "/weave/" for a project page), inject a
 *    `<base href>` and make asset paths relative so they resolve under the sub-path
 *    at any URL depth. The router reads that same `<base href>` for its basename.
 *    Default (no DOCS_BASE) = root: nothing rewritten, absolute paths kept.
 */

import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

let base = (process.env.DOCS_BASE || '/').trim();
if (base && !base.endsWith('/')) base += '/';
const useBase = base !== '/' && base !== '';

if (useBase) {
  const indexPath = join(dist, 'index.html');
  let html = await readFile(indexPath, 'utf8');
  // 1) Make the build's absolute asset refs relative so they respect <base>.
  //    (Do this BEFORE injecting <base>, so the base href keeps its leading slash.)
  html = html.replace(/(href|src)="\/(?!\/)/g, '$1="');
  // 2) Inject <base> right after <head> so relative URLs resolve under the sub-path.
  html = html.replace(/<head>/, `<head>\n    <base href="${base}" />`);
  await writeFile(indexPath, html, 'utf8');
}

await copyFile(join(dist, 'index.html'), join(dist, '404.html'));
await writeFile(join(dist, '.nojekyll'), '');

console.log(`postbuild → 404.html + .nojekyll${useBase ? ` + <base href="${base}">` : ''}`);
