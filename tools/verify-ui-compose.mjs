/**
 * End-to-end proof that a @weave-framework/ui component which COMPOSES a child component
 * resolves that child through the standard consumer `weave build` path — the real esbuild
 * loader (`packages/cli/src/plugin.ts`), NOT the library's internal `_c`-injection tooling
 * (`toComponent`) the browser tests use.
 *
 * `<Autocomplete>`'s template contains `<Input …/>` with no import of Input in its source.
 * In module mode the compiled render references a bare `Input`; the loader must wire it to a
 * real import (`../input/input.js`) by convention, or the mount throws a swallowed
 * ReferenceError and renders blank. This test builds the fixture with the real plugin, mounts
 * it headless, and asserts the composed `<input>` is in the DOM.
 *
 * Revert the child-import injection in the plugin (or the compiler's `components` tracking)
 * and this fails — the whole point (see the definition-of-done: a test that fails without the fix).
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

// The consumer app entry, fed to esbuild via stdin so this test needs no committed fixture
// (and resolves `@weave-framework/*` from the workspace via `resolveDir: repo`). It mounts a ui
// component that COMPOSES a child (`<Autocomplete>` → `<Input>`) through the default export the
// loader synthesizes — the real consumption path, not the library's internal `_c` tooling.
const APP = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Autocomplete from '@weave-framework/ui/autocomplete';
mountComponent(Autocomplete, '#app', {
  options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }],
  placeholder: 'Search fruit',
});
`;

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

// 1. Bundle the real Weave esbuild plugin so this Node script can use it as the loader.
const tmp = mkdtempSync(join(tmpdir(), 'weave-ui-compose-'));
const pluginJs = join(tmp, 'plugin.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/plugin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: pluginJs,
  // node built-ins + esbuild (types only) are provided by the host runtime.
  external: ['esbuild'],
});
const { weave } = await import(pathToFileURL(pluginJs).href);

// 2. Build the consumer app with the plugin (build mode — CSS collected into state).
const state = { css: [] };
const result = await build({
  stdin: { contents: APP, resolveDir: repo, sourcefile: 'ui-compose-app.ts', loader: 'ts' },
  bundle: true,
  format: 'iife',
  write: false,
  plugins: [weave(state, { dev: false })],
});
const js = result.outputFiles[0].text;

// 3. Run it headless and assert the composed child mounted.
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
await page.addScriptTag({ content: js });

ok(errors.length === 0, `no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);

// The parent forwards `class="weave-autocomplete"` onto the composed Input's root wrapper.
const wrapper = page.locator('#app div.weave-autocomplete');
ok((await wrapper.count()) === 1, 'composed <Input> child mounted inside <Autocomplete>');

const input = page.locator('#app div.weave-autocomplete input');
ok((await input.count()) === 1, 'the composed field rendered a native <input>');
ok(
  (await input.getAttribute('placeholder')) === 'Search fruit',
  'the child received a prop forwarded from the parent template'
);
ok((await input.getAttribute('role')) === 'combobox', 'Autocomplete wired combobox ARIA onto the composed field');

await browser.close();
console.log('\nUI composition build path verified (child resolved via the real loader).');
