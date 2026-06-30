/**
 * Post-build for GitHub Pages:
 *  - 404.html = a copy of index.html, so deep links (e.g. /learn/signals) boot the
 *    SPA instead of 404'ing (Pages serves 404.html for unknown paths).
 *  - .nojekyll so Pages serves files/dirs starting with `_` and skips Jekyll.
 */

import { copyFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

await copyFile(join(dist, 'index.html'), join(dist, '404.html'));
await writeFile(join(dist, '.nojekyll'), '');

console.log('postbuild → 404.html (SPA fallback) + .nojekyll');
