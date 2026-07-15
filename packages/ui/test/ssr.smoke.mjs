/**
 * Node smoke for UI SSR-safety (Phase E, E1.3d docs dogfood) — the CDK + Icon must not touch browser-only
 * APIs during a headless render. The server DOM (`runtime/server`) installs a `document` global but NOT
 * `window`, so browser detection must key off `window`; and there is no `DOMParser`, so the SVG sanitizer
 * must fail closed.
 *
 * Installs the server DOM FIRST, then loads the CDK's platform + bidi (whose module init reads the text
 * direction — it crashed on `document.documentElement.dir` before the fix) and the Icon sanitizer.
 *
 * Run: `node packages/ui/test/ssr.smoke.mjs` (wired as `pnpm verify:ui-ssr`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// runtime/server is imported FIRST so its installServerDom() runs (document global, no window) before the CDK
// modules evaluate — bidi.ts reads the direction at module-init and would throw without the isBrowser fix.
// Namespace-import + reference runtime/server so esbuild keeps it (it's \`sideEffects:false\`, so a bare
// import is tree-shaken) AND evaluates it FIRST — its installServerDom() must run before the CDK modules.
const entry = `
  import * as _server from '@weave-framework/runtime/server';
  import { isBrowser } from './packages/ui/src/cdk/platform.ts';
  import { direction } from './packages/ui/src/cdk/bidi.ts';
  import { sanitizeSvg } from './packages/ui/src/icon/icon.ts';
  export const serverKeep = typeof _server;
  export { isBrowser, direction, sanitizeSvg };
`;
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'ui-ssr-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'ui-ssr-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: out,
});
// The import itself is a test: bidi's module init runs here — a throw fails the smoke.
const { isBrowser, direction, sanitizeSvg } = await import(pathToFileURL(out).href);

console.log('verify:ui-ssr — CDK + Icon under the headless DOM\n');

ok(typeof globalThis.document !== 'undefined', 'server DOM installed a `document` global');
ok(typeof globalThis.window === 'undefined', 'no `window` global (headless — the honest browser signal)');
ok(isBrowser === false, 'isBrowser is false under the server DOM (detects window, not the document shim)');
ok(direction() === 'ltr', 'bidi initialized to ltr without crashing on document.documentElement.dir');
ok(sanitizeSvg('') === '', 'sanitizeSvg: empty input → empty');
ok(
  sanitizeSvg('<svg onload="alert(1)"><path d="M0 0"/></svg>') === '',
  'sanitizeSvg fails closed with no DOMParser (never emits un-sanitized markup on the server)'
);

console.log('');
if (failures) {
  console.error(`✖ ${failures} ui-ssr check(s) failed.`);
  process.exit(1);
}
console.log('✓ UI CDK + Icon are SSR-safe under the headless DOM.');
