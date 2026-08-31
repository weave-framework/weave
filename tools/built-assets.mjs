/**
 * What a build actually wrote, read from the document it wrote it into.
 *
 * The entry and the stylesheet carry content hashes, so their names change with their contents and
 * cannot be known in advance. Eight test files used to spell `main.js` and `app.css` out, which was a
 * coincidence they were asserting rather than a fact: the moment the build named them anything else,
 * every one of them failed on a filename while the thing they actually check was fine.
 *
 * `dist/index.html` is the authoritative answer, because it is what a browser loads. Falling back to a
 * directory scan keeps this usable for a build that writes no shell (a library config, `--ssg` before
 * its documents are written).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The entry module and stylesheet a build emitted into `dist`, as bare filenames. */
export function builtAssets(dist) {
  let html = '';
  try {
    html = readFileSync(join(dist, 'index.html'), 'utf8');
  } catch {
    /* no shell — fall through to the directory */
  }
  const fromHtml = (re) => {
    const m = re.exec(html);
    return m ? m[1].split('?')[0].split('/').pop() : undefined;
  };
  const files = (() => {
    try {
      return readdirSync(dist);
    } catch {
      return [];
    }
  })();
  const scan = (re) => files.find((f) => re.test(f));

  return {
    script: fromHtml(/<script[^>]+src=["']([^"']+\.js)["']/i) ?? scan(/^main(-[A-Za-z0-9]+)?\.js$/) ?? 'main.js',
    css: fromHtml(/<link[^>]+href=["']([^"']+\.css)["']/i) ?? scan(/^app(-[A-Za-z0-9]+)?\.css$/) ?? 'app.css',
  };
}

/** Convenience: the absolute paths, for a test that wants to read the bytes. */
export function builtAssetPaths(dist) {
  const { script, css } = builtAssets(dist);
  return { script: join(dist, script), css: join(dist, css) };
}
