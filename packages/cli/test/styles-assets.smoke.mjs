/**
 * FW-7 proof: a CSS listed in `styles:[…]` gets its `url(...)` assets (fonts, images)
 * resolved + emitted, not dropped. Before the fix the CSS text was bundled but its
 * `url(./files/x.woff2)` was left untouched → the asset 404s (silent font fallback).
 *
 * Bundles the CLI TS source on the fly (esbuild; esbuild/sass/typescript external), writes a
 * temp fixture stylesheet with relative + external + data: url()s, then checks:
 *   1) compileStyleFileWithAssets rewrites the relative url()s → /assets/…, lists the assets,
 *      leaves external/data: refs alone, dedupes repeated refs.
 *   2) build() emits each asset into dist/assets/ and app.css carries the rewritten url().
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

// ── Bundle styles.ts + build.ts into one temp module and import it ──
// The bundled module keeps esbuild/sass/typescript external, so it must live inside the repo
// tree where node_modules resolves them (a tmpdir has no node_modules).
const modDir = mkdtempSync(join(repo, 'packages', 'cli', 'test', '.smoke-'));
const entry = join(modDir, 'entry.ts');
writeFileSync(
  entry,
  `export { compileStyleFileWithAssets } from ${JSON.stringify(join(repo, 'packages/cli/src/styles.ts').replace(/\\/g, '/'))};\n` +
    `export { build } from ${JSON.stringify(join(repo, 'packages/cli/src/build.ts').replace(/\\/g, '/'))};\n` +
    `export { dev } from ${JSON.stringify(join(repo, 'packages/cli/src/dev.ts').replace(/\\/g, '/'))};\n`
);
const outMod = join(modDir, 'cli.mjs');
await esbuild({
  entryPoints: [entry],
  outfile: outMod,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['esbuild', 'sass', 'typescript'],
});
const { compileStyleFileWithAssets, build, dev } = await import(pathToFileURL(outMod).href);

// ── Fixture: a stylesheet referencing a font + image + external + data: url() ──
const fix = mkdtempSync(join(tmpdir(), 'weave-fw7-'));
mkdirSync(join(fix, 'styles', 'files'), { recursive: true });
writeFileSync(join(fix, 'styles', 'files', 'font.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32])); // "wOF2"
writeFileSync(join(fix, 'styles', 'files', 'bg.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const cssPath = join(fix, 'styles', 'main.css');
writeFileSync(
  cssPath,
  [
    `@font-face { font-family: 'X'; src: url(./files/font.woff2) format('woff2'); }`,
    `.hero { background: url("./files/bg.png"); }`,
    `.dup { background: url(./files/bg.png); }`, // repeat → same served path
    `.ext { background: url(https://cdn.example.com/y.woff2); }`,
    `.data { background: url(data:image/png;base64,AAAA); }`,
    `.abs { background: url(/already/served.png); }`,
  ].join('\n')
);

/* 1) compileStyleFileWithAssets */
const { css, assets } = await compileStyleFileWithAssets(cssPath);
ok(/url\(\/assets\/[0-9a-f]{8}-font\.woff2\)/.test(css), 'relative woff2 url() rewritten to /assets/…');
ok(/url\(\/assets\/[0-9a-f]{8}-bg\.png\)/.test(css), 'relative png url() rewritten to /assets/…');
ok(css.includes('url(https://cdn.example.com/y.woff2)'), 'external http url() left untouched');
ok(css.includes('data:image/png;base64,AAAA'), 'data: url() left untouched');
ok(css.includes('url(/already/served.png)'), 'root-absolute url() left untouched');
ok(assets.length === 2, `exactly 2 assets discovered + deduped (got ${assets.length})`);
ok(
  assets.every((a) => existsSync(a.absPath) && a.servedPath.startsWith('assets/')),
  'each asset has a real source path + an assets/ served path'
);

/* 2) build() emits the assets + rewrites app.css */
const outDir = join(fix, 'dist');
writeFileSync(join(fix, 'main.ts'), 'export {};\n');
await build({ entry: join(fix, 'main.ts'), outDir, styles: [cssPath], minify: false });

const appCss = readFileSync(join(outDir, 'app.css'), 'utf8');
ok(/url\(\/assets\/[0-9a-f]{8}-font\.woff2\)/.test(appCss), 'build: app.css carries the rewritten font url()');
ok(!appCss.includes('url(./files/font.woff2)'), 'build: the original relative url() is gone (the bug)');
const m = appCss.match(/\/assets\/([0-9a-f]{8}-font\.woff2)/);
ok(m && existsSync(join(outDir, 'assets', m[1])), 'build: the woff2 asset was emitted into dist/assets/');
const pngM = appCss.match(/\/assets\/([0-9a-f]{8}-bg\.png)/);
ok(pngM && existsSync(join(outDir, 'assets', pngM[1])), 'build: the png asset was emitted into dist/assets/');

/* 3) dev() serves the asset over HTTP (no 404) */
const fontAsset = assets.find((a) => a.servedPath.endsWith('font.woff2'));
const server = await dev({
  entry: join(fix, 'main.ts'),
  outdir: join(fix, 'dev-out'),
  servedir: fix,
  styles: [cssPath],
  inMemory: true,
});
try {
  const res = await fetch(`${server.url}/${fontAsset.servedPath}`);
  ok(res.status === 200, `dev: GET /${fontAsset.servedPath} → 200 (not a 404)`);
  ok((res.headers.get('content-type') ?? '').includes('font/woff2'), 'dev: served with font/woff2 content-type');
  const bytes = new Uint8Array(await res.arrayBuffer());
  ok(bytes.length === 4 && bytes[0] === 0x77, 'dev: served the real font bytes');
} finally {
  await server.ctx.dispose();
}

rmSync(modDir, { recursive: true, force: true });
rmSync(fix, { recursive: true, force: true });
console.log('\n✓ FW-7: styles url() assets are served (dev) + emitted (build) — no silent 404.');
process.exit(0); // the dev server / esbuild watch keep the loop alive; we're done.
