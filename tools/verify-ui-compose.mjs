/**
 * End-to-end proof that a @weave-framework/ui component which COMPOSES a child component
 * resolves that child through the standard consumer `weave build` path — the real esbuild
 * loader (`packages/cli/src/plugin.ts`), NOT the library's internal `_c`-injection tooling
 * (`toComponent`) the browser tests use.
 *
 * Two scenarios, both mounted headless through the synthesized default export:
 *
 *  1. `<Autocomplete>` → `<Input>` — a child at the template top level. In module mode the
 *     compiled render references a bare `Input`; the loader must wire it to a real import
 *     (`../input/input.js`) by convention, or the mount throws a swallowed ReferenceError and
 *     renders blank. Reverting the child-import injection (plugin) or `components` tracking
 *     (compiler) breaks this.
 *
 *  2. `<Table selectable>` → `<Checkbox>` — a child nested INSIDE `@if`/`@for` blocks, in a
 *     component whose JSDoc shows an `import Checkbox from '@weave-framework/ui/checkbox'`
 *     usage example. That commented example must NOT fool the auto-resolver's "already
 *     imported?" check (it did — `importsBinding` scanned comments too — which silently blanked
 *     `<Table selectable>`). Reverting `stripComments` in `importsBinding` breaks this.
 *
 * See the definition-of-done: each assertion fails without its fix.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// 1. Bundle the real Weave esbuild plugin so this Node script can use it as the loader.
//
// The bundle must live INSIDE the repo: `esbuild` and `typescript` stay external (they are the host's, and
// bundling TypeScript would add ~9.5 MB per run), and Node resolves an external only from the importer's
// location — from a tmp dir there is no node_modules to find. The fixture below still uses a tmp dir; only
// the bundle moved. (This broke exactly once, when `typescript` joined the external list and nothing here
// re-ran until later.)
const tmp = mkdtempSync(join(tmpdir(), 'weave-ui-compose-'));
const pluginJs = join(repo, 'tools', '.verify-ui-compose-plugin.mjs');
process.on('exit', () => rmSync(pluginJs, { force: true }));
await build({
  entryPoints: [join(repo, 'packages/cli/src/plugin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: pluginJs,
  // node built-ins + esbuild + typescript are provided by the host runtime.
  external: ['esbuild', 'typescript'],
});
const { weave } = await import(pathToFileURL(pluginJs).href);

// Build one consumer app (build mode — CSS collected into state) and return the IIFE bundle.
// `resolveDir: repo` resolves `@weave-framework/*` from the workspace, so the real ui SOURCE
// (`.ts` + sibling declarations) flows through the plugin — the real consumption path.
async function compile(app, sourcefile) {
  const state = { css: [] };
  const result = await build({
    stdin: { contents: app, resolveDir: repo, sourcefile, loader: 'ts' },
    bundle: true,
    format: 'iife',
    write: false,
    plugins: [weave(state, { dev: false })],
  });
  return result.outputFiles[0].text;
}

// Mount an IIFE bundle into a fresh page and return { page, errors } for assertions.
async function mount(browser, js) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: js });
  return { page, errors };
}

const browser = await chromium.launch();

/* ── Scenario 1: <Autocomplete> → <Input> (top-level composed child) ── */
{
  const app = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Autocomplete from '@weave-framework/ui/autocomplete';
mountComponent(Autocomplete, '#app', {
  options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }],
  placeholder: 'Search fruit',
});
`;
  const { page, errors } = await mount(browser, await compile(app, 'ui-compose-autocomplete.ts'));
  ok(errors.length === 0, `Autocomplete: no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);

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
  await page.close();
}

/* ── Scenario 2: <Table selectable> → <Checkbox> (child nested inside @if/@for) ── */
{
  const app = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Table from '@weave-framework/ui/table';
const columns = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'role', header: 'Role' },
];
const rows = [
  { id: 1, name: 'Ada', role: 'Eng' },
  { id: 2, name: 'Alan', role: 'Math' },
];
mountComponent(Table, '#app', {
  columns,
  dataSource: rows,
  selectable: true,
  selectionMode: 'multiple',
  trackBy: (r) => r.id,
  ariaLabel: 'Team',
});
`;
  const { page, errors } = await mount(browser, await compile(app, 'ui-compose-table.ts'));
  ok(errors.length === 0, `Table: no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);

  // Before the fix the whole render throws (bare `Checkbox`) and the table never mounts.
  ok((await page.locator('#app table').count()) === 1, 'the <Table> rendered its <table>');

  // One composed <Checkbox> per row + the select-all in the header = 3 for 2 rows.
  const boxes = page.locator('#app .weave-checkbox');
  ok((await boxes.count()) === 3, 'the composed <Checkbox> selection column rendered (select-all + one per row)');
  ok(
    (await page.locator('#app thead .weave-checkbox input[type=checkbox]').count()) === 1,
    'the select-all header rendered a real <Checkbox> (native <input type=checkbox>)'
  );
  ok(
    (await page.locator('#app tbody .weave-checkbox input[type=checkbox]').count()) === 2,
    'each body row rendered a composed <Checkbox>'
  );
  await page.close();
}

await browser.close();
console.log('\nUI composition build path verified (top-level + @if/@for-nested children resolved via the real loader).');
