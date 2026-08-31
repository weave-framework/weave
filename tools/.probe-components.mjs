/**
 * Check the claims the Components page makes, against the build rather than against memory.
 *
 *   A. A `.ts` with NO exports at all is a component when a sibling `.html` exists.
 *   B. `setup` is recognised as `function`, as `const` arrow, and as `async function`.
 *   C. A prop the parent passes as an explicit `undefined` counts as PASSED, so `propDefaults`
 *      does not apply — the page says so, and that is a fine distinction worth verifying.
 */
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginJs = join(repo, 'tools', '.probe-components-plugin.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/plugin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: pluginJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { weave } = await import(pathToFileURL(pluginJs).href);

async function compile(files, entry) {
  const app = mkdtempSync(join(repo, 'tools', '.probe-comp-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(app, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  try {
    const r = await build({
      entryPoints: [join(app, entry)],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      logLevel: 'silent',
      external: ['@weave-framework/*'],
      plugins: [weave({ css: [] }, {})],
    });
    return { ok: true, code: r.outputFiles[0].text, warnings: r.warnings.map((w) => w.text) };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e).slice(0, 200) };
  } finally {
    rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const show = (label, r, probe) => {
  console.log(`\n${label}`);
  if (!r.ok) return console.log(`   BUILD FAILED: ${r.error}`);
  console.log(`   built ok${r.warnings.length ? `, warnings: ${JSON.stringify(r.warnings)}` : ''}`);
  if (probe) console.log(`   ${probe(r.code)}`);
};

// A — no exports at all, sibling template
show(
  'A. a .ts with NO exports + a sibling .html',
  await compile({ 'header.ts': '// nothing here at all\n', 'header.html': '<h1>Hi</h1>\n' }, 'header.ts'),
  (c) => `defineComponent emitted: ${/defineComponent/.test(c)}`
);

// B — the three spellings of setup
for (const [label, script] of [
  ['function', 'export function setup() {\n  const n = 1;\n}\n'],
  ['const arrow', 'export const setup = () => {\n  const n = 1;\n};\n'],
  ['async function', 'export async function setup() {\n  const n = 1;\n}\n'],
]) {
  show(
    `B. setup as ${label}`,
    await compile({ 'c.ts': script, 'c.html': '<p>{{ n }}</p>\n' }, 'c.ts'),
    (c) => `auto-return emitted: ${/return\s*\{\s*n\s*\}/.test(c)}`
  );
}

// C — propDefaults vs an explicitly passed undefined
show(
  'C. propDefaults + a parent that passes undefined explicitly',
  await compile(
    {
      'child.ts': "export const propDefaults = { size: 'md' };\nexport function setup(props: { size?: string }) {\n  const size = () => props.size;\n}\n",
      'child.html': '<p>{{ size() }}</p>\n',
      'parent.ts': "import Child from './child';\nvoid Child;\nexport function setup() {\n  const nothing = undefined;\n}\n",
      'parent.html': '<Child size={{ nothing }} />\n',
    },
    'parent.ts'
  ),
  (c) => `propDefaults present in output: ${/propDefaults/.test(c)}`
);

rmSync(pluginJs, { force: true });
