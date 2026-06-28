/**
 * M7a end-to-end proof: a real `.weave` SFC → esbuild bundle (via the Weave
 * loader) → mounted + reactive in headless Chromium, with scoped CSS applied.
 *
 * The Weave esbuild plugin is inlined here (it mirrors the canonical
 * `compileComponent`/`parseSfc` loader). The dev server + a shipped `@weave/cli`
 * plugin package land in M7b.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

// 1. Bundle @weave/compiler to JS so this Node script can call the loader.
const tmp = mkdtempSync(join(tmpdir(), 'weave-build-'));
const compilerJs = join(tmp, 'compiler.mjs');
await build({
  entryPoints: ['packages/compiler/src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: compilerJs,
});
const { compileComponent, parseSfc } = await import(pathToFileURL(compilerJs).href);

// 2. Weave esbuild plugin: compile each .weave to a module, collect scoped CSS.
const cssChunks = [];
const weave = {
  name: 'weave',
  setup(b) {
    b.onLoad({ filter: /\.weave$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { code, css } = compileComponent(parseSfc(source), { filename: args.path });
      if (css) cssChunks.push(css);
      return { contents: code, loader: 'ts', resolveDir: dirname(args.path) };
    });
  },
};

// 3. Build the example app.
const result = await build({
  entryPoints: ['examples/v2/main.ts'],
  bundle: true,
  format: 'iife',
  write: false,
  plugins: [weave],
});
const js = result.outputFiles[0].text;
const css = cssChunks.join('\n');
ok(css.includes('[data-w-'), 'scoped CSS was collected from the .weave');

// 4. Run it headless and assert mount + reactivity + scoped style.
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(
  `<!doctype html><html><head><style>${css}</style></head><body><div id="app"></div></body></html>`
);
await page.addScriptTag({ content: js });
ok(errors.length === 0, `no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);

const btn = page.locator('#app button');
ok((await btn.textContent()) === 'count: 0', 'component mounted with initial state');

const color = await btn.evaluate((el) => getComputedStyle(el).color);
ok(color === 'rgb(0, 128, 0)', 'scoped CSS applied to the component');

await btn.click();
await btn.click();
ok((await btn.textContent()) === 'count: 2', 'click updates reactively (fine-grained)');

await browser.close();
console.log('\nM7a build pipeline verified.');
