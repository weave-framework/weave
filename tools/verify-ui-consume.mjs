/**
 * The @weave-framework/ui CONSUMPTION gate — proves a real npm consumer can do the
 * documented `import Button from '@weave-framework/ui/button'` against the BUILT dist.
 *
 * This is the gap the older `verify-ui-compose.mjs` could not catch: that gate compiles
 * the ui SOURCE through the loader (resolveDir → src), which the monorepo dev exports
 * also do — so both mask the fact that the plain-tsc dist shipped components with NO
 * default export (`export const template` / `export function setup`, no `render`, no
 * `defineComponent`). A real consumer gets the dist and both `weave build` (esbuild:
 * "No matching export for default") and `weave check` (tsc: TS1192) fail.
 *
 * Three checks, all against `packages/ui/dist` (run `pnpm build:packages` first):
 *   1. SHAPE (every component): dist `.js` AND `.d.ts` expose a `default` export.
 *   2. BUILD + MOUNT (representative): a consumer app importing from DIST via the real
 *      `@weave-framework/ui/*` specifier bundles + mounts + renders — Button (no child),
 *      Autocomplete (composes <Input>), Table (composes <Checkbox> inside @if/@for).
 *   3. TYPES: a consumer type-checks `import Button` from dist — props are typed off the
 *      component (a bad prop is a compile error), and there IS a default to import.
 *
 * Each check fails if the build regresses to shipping uncompiled components.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repo = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repo, 'packages/ui/src');
const distDir = join(repo, 'packages/ui/dist');

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

if (!existsSync(distDir)) {
  console.error('✖ packages/ui/dist not found — run `pnpm build:packages` first.');
  process.exit(1);
}

// Bundle the compiler to detect which src modules are components (declare an inline template).
const tmp = mkdtempSync(join(tmpdir(), 'weave-ui-consume-'));
const compilerJs = join(tmp, 'compiler.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: compilerJs,
});
const { extractSources } = await import(pathToFileURL(compilerJs).href);

/* ── 1. SHAPE: every component's dist .js + .d.ts export a default ── */

function componentModules() {
  const mods = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !/\.(browser|test|spec)\.ts$/.test(full)) {
        const decl = extractSources(readFileSync(full, 'utf8'));
        if (decl.template !== undefined) mods.push(relative(srcDir, full).replace(/\.ts$/, '').replace(/\\/g, '/'));
      }
    }
  };
  walk(srcDir);
  return mods;
}

const components = componentModules();
ok(components.length >= 29, `found ${components.length} component modules in src`);

let shapeOk = 0;
for (const rel of components) {
  const js = join(distDir, rel + '.js');
  const dts = join(distDir, rel + '.d.ts');
  const jsHasDefault = existsSync(js) && /(^|\n)export\s+default\b|export\s*\{[^}]*\bas\s+default\b/.test(readFileSync(js, 'utf8'));
  const dtsHasDefault = existsSync(dts) && /(^|\n)export\s+default\b/.test(readFileSync(dts, 'utf8'));
  if (jsHasDefault && dtsHasDefault) shapeOk++;
  else console.error(`   ✖ ${rel}: js default=${jsHasDefault} dts default=${dtsHasDefault}`);
}
ok(shapeOk === components.length, `all ${components.length} components ship a default export in dist (.js + .d.ts)`);

/* ── 2. BUILD + MOUNT: consume the DIST through the real @weave-framework/ui/* specifier ── */

// Alias the top-level ui specifiers to their DIST modules so the consumer bundle exercises
// exactly what publishConfig.exports point at (a real install resolves there). Sibling
// (`../input/input.js`) and runtime imports inside dist resolve normally.
function uiDistAlias() {
  const alias = {};
  for (const rel of components) alias['@weave-framework/ui/' + rel.split('/')[0]] = join(distDir, rel + '.js');
  return alias;
}

async function bundleConsumer(app, sourcefile) {
  const result = await build({
    stdin: { contents: app, resolveDir: repo, sourcefile, loader: 'ts' },
    bundle: true,
    format: 'iife',
    write: false,
    alias: uiDistAlias(),
  });
  return result.outputFiles[0].text;
}

async function mount(browser, js) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: js });
  return { page, errors };
}

const browser = await chromium.launch();

// Button — no children; the plainest proof the default export mounts from dist.
{
  const app = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Button from '@weave-framework/ui/button';
mountComponent(Button, '#app', { variant: 'outline' });
`;
  const { page, errors } = await mount(browser, await bundleConsumer(app, 'consume-button.ts'));
  ok(errors.length === 0, `Button (dist): no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);
  const btn = page.locator('#app button.weave-button--outline');
  ok((await btn.count()) === 1, 'Button (dist) mounted its native <button> with the variant class');
  await page.close();
}

// Autocomplete — composes <Input>; proves sibling child-import resolution survives the dist build.
{
  const app = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Autocomplete from '@weave-framework/ui/autocomplete';
mountComponent(Autocomplete, '#app', {
  options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }],
  placeholder: 'Search fruit',
});
`;
  const { page, errors } = await mount(browser, await bundleConsumer(app, 'consume-autocomplete.ts'));
  ok(errors.length === 0, `Autocomplete (dist): no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);
  const input = page.locator('#app div.weave-autocomplete input');
  ok((await input.count()) === 1, 'Autocomplete (dist) resolved + mounted its composed <Input> child');
  ok((await input.getAttribute('placeholder')) === 'Search fruit', 'the composed child received a forwarded prop');
  await page.close();
}

// Table selectable — composes <Checkbox> nested inside @if/@for.
{
  const app = `
import { mountComponent } from '@weave-framework/runtime/dom';
import Table from '@weave-framework/ui/table';
mountComponent(Table, '#app', {
  columns: [{ key: 'name', header: 'Name' }],
  dataSource: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Alan' }],
  selectable: true,
  selectionMode: 'multiple',
  trackBy: (r) => r.id,
  ariaLabel: 'Team',
});
`;
  const { page, errors } = await mount(browser, await bundleConsumer(app, 'consume-table.ts'));
  ok(errors.length === 0, `Table (dist): no runtime errors${errors.length ? ': ' + errors.join('; ') : ''}`);
  ok((await page.locator('#app table').count()) === 1, 'Table (dist) mounted');
  ok((await page.locator('#app .weave-checkbox').count()) === 3, 'Table (dist) resolved its composed <Checkbox> (select-all + one per row)');
  await page.close();
}

await browser.close();

/* ── 3. TYPES: a consumer type-checks `import Button` from dist ── */
{
  const consumer = join(tmp, 'consume.ts');
  writeFileSync(
    consumer,
    [
      `import Button from ${JSON.stringify(join(distDir, 'button/button.js').replace(/\\/g, '/'))};`,
      // props are derived from the component — a good prop is fine…
      `const good: Parameters<typeof Button>[0] = { variant: 'outline' };`,
      // …and a bad one is a compile error (proves props are actually typed, not `any`).
      `// @ts-expect-error unknown prop must be rejected`,
      `const bad: Parameters<typeof Button>[0] = { nope: 1 };`,
      `void good; void bad;`,
    ].join('\n')
  );

  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
  };
  const program = ts.createProgram([consumer], options);
  const diags = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()].filter(
    (d) => d.file && d.file.fileName === consumer.replace(/\\/g, '/')
  );
  const messages = diags.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  ok(diags.length === 0, `Button (dist): consumer type-checks clean${messages.length ? ' — ' + messages.join('; ') : ''}`);
}

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ @weave-framework/ui is consumable from dist (shape + build/mount + types).');
