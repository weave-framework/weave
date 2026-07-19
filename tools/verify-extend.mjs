/**
 * End-to-end proof of RFC 0008 `#3` — a component-file extension that PATCHES its base's
 * template — through the REAL esbuild loader (`packages/cli/src/plugin.ts`), the path a real
 * `weave build` takes. A local base is patched by an extension declaring `export const extend`
 * + `export const patch = [ … ]`; the loader resolves the base template, applies the ops, and
 * compiles with the BASE's hash so the base's scoped CSS still matches.
 *
 * Each assertion fails without the feature (revert `patch.ts` / the plugin `#3` branch):
 *  - the attr patch lands on EVERY `@for` row (the build-time correctness that runtime DOM
 *    patching can't give — dynamically-generated rows are patched too);
 *  - the base's setup context is reused (rows come from the base reading props);
 *  - the extension's own setup key drives prepended markup;
 *  - the base's scoped CSS applies to the extension (base-hash reuse).
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

// Bundle the real Weave esbuild plugin so this Node script can use it as the loader.
const tmp = mkdtempSync(join(repo, '.weave-extend-'));
try {
  const pluginJs = join(tmp, 'plugin.mjs');
  await build({
    entryPoints: [join(repo, 'packages/cli/src/plugin.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: pluginJs,
    external: ['esbuild', 'typescript'],
  });
  const { weave } = await import(pathToFileURL(pluginJs).href);

  // ── Fixture: a LOCAL base component + a `#3` extension that patches it ──
  // Base: a keyed @for list, a `.wrow` per item, plus scoped CSS colouring the row.
  writeFileSync(
    join(tmp, 'list.ts'),
    `export const template = '<ul class="wlist">@for (item of items(); track item) {<li class="wrow">{{ item }}</li>}</ul>';
export const styles = '.wrow { color: rgb(1, 2, 3); }';
export function setup(props) {
  return { items: () => props.items ?? [] };
}
`
  );
  // Extension (#3): reuse the base setup, add `heading`; patch the base template — add an attr to
  // EVERY row and prepend a header. No own template.
  writeFileSync(
    join(tmp, 'my-list.ts'),
    `import List from './list';
export const extend = List;
export const patch = [
  { op: 'attr', sel: '.wrow', attr: 'data-ext="yes"' },
  { op: 'prepend', sel: '.wlist', html: '<li class="whead">{{ heading() }}</li>' },
];
export function setup(props, base) {
  return { ...base, heading: () => 'EXT-' + base.items().length };
}
`
  );
  writeFileSync(
    join(tmp, 'app.ts'),
    `import { mountComponent } from '@weave-framework/runtime/dom';
import MyList from './my-list';
mountComponent(MyList, '#app', { items: ['a', 'b', 'c'] });
`
  );

  const state = { css: [] };
  const result = await build({
    entryPoints: [join(tmp, 'app.ts')],
    bundle: true,
    format: 'iife',
    write: false,
    absWorkingDir: repo,
    plugins: [weave(state, { dev: false })],
  });
  const js = result.outputFiles[0].text;
  const css = state.css.join('\n');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div id="app"></div></body></html>`);
  await page.addScriptTag({ content: js });

  ok(errors.length === 0, `#3 extension: no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);

  // Base template used → the extension mounted the base's <ul>.
  ok((await page.locator('#app ul.wlist').count()) === 1, 'the base template rendered (extension reused it)');

  // Base setup reused → three rows from the base reading props.items.
  const rows = page.locator('#app li.wrow');
  ok((await rows.count()) === 3, 'the base setup was reused (3 rows from props via the base @for)');

  // THE point: the attr patch is on EVERY @for-generated row (build-time correctness).
  const patched = page.locator('#app li.wrow[data-ext="yes"]');
  ok((await patched.count()) === 3, 'the attr patch applied to ALL dynamically-generated rows');

  // The extension's own setup key drives the prepended header.
  const head = page.locator('#app li.whead');
  ok((await head.count()) === 1, 'the prepend patch inserted a header');
  ok((await head.textContent()) === 'EXT-3', "the header reads the extension's setup key (over the base context)");

  // Base scoped CSS still matches (the extension compiled with the base's hash).
  const color = await rows.first().evaluate((el) => getComputedStyle(el).color);
  ok(color === 'rgb(1, 2, 3)', `the base's scoped CSS applies to the extension (got ${color})`);

  await browser.close();
  console.log('\n✔ verify-extend: RFC 0008 #3 works end-to-end through the loader');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
