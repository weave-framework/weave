/**
 * Node smoke test for @weave-framework/check — `export const propDefaults`. A prop that
 * has a default becomes OPTIONAL for a parent (the child fills it), while a prop
 * WITHOUT a default stays required. Two assertions isolate that:
 *   1. a parent that omits a defaulted prop → no "missing property" error;
 *   2. a parent that omits a NON-defaulted required prop → still errors (control).
 *
 * Run: `node packages/check/test/propdefaults.smoke.mjs` (wired into verify:check).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'check-for-propdefaults-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'check', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript'],
  outfile: out,
});
const { checkProject } = await import(pathToFileURL(out).href);

console.log('\npackages/check/test/propdefaults.smoke.mjs');

/** A child with a defaulted `variant` + a required `label`, and a parent template. */
function check(parentHtml) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-propdef-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'child.ts'),
    `export const propDefaults = { variant: 'primary' };\n` +
      `export function setup(_props: { label: string; variant: string }): Record<string, never> { return {}; }\n`
  );
  writeFileSync(join(dir, 'app', 'child.html'), `<b>{{ '' }}</b>\n`);
  writeFileSync(join(dir, 'app', 'page.ts'), `import Child from './child';\nvoid Child;\nexport function setup(): Record<string, never> { return {}; }\n`);
  writeFileSync(join(dir, 'app', 'page.html'), parentHtml);
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

// 1. Omitting the defaulted `variant` is fine (the child supplies it).
{
  const diags = check(`<Child label="x" />\n`);
  ok(diags.length === 0, `omitting a defaulted prop (variant) is accepted — got ${diags.length}`);
  if (diags.length) for (const d of diags) console.log(`      · ${d.message}`);
}

// 2. Omitting the required, non-defaulted `label` still errors (control).
{
  const diags = check(`<Child />\n`);
  const missing = diags.some((d) => /label/.test(d.message));
  ok(missing, `omitting a required non-defaulted prop (label) is still reported — got ${diags.length} diag(s)`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ propDefaults smoke passed');
process.exit(failures ? 1 : 0);
