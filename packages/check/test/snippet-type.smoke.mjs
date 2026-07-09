/**
 * Node smoke test for @weave-framework/check — a `@snippet` is typed `() => Node` (it renders DOM),
 * so passing one to a component's template prop typed `(row) => Node` (rowTemplate / itemTemplate /
 * tabTemplate on a locally-typed component) must NOT flag a spurious `void` vs `Node` error. Guards
 * the emit-side snippet return type (regression: it was emitted `(): void`, which failed the check).
 *
 * Run: `node packages/check/test/snippet-type.smoke.mjs` (wired as part of `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-snippet-test.mjs');
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

console.log('\npackages/check/test/snippet-type.smoke.mjs');

// A local child component with a STRICTLY typed `(n) => Node` template prop, and a parent that
// passes a `@snippet` to it — exactly the rowTemplate/itemTemplate/tabTemplate authoring pattern.
const dir = mkdtempSync(join(tmpdir(), 'weave-snippet-'));
mkdirSync(join(dir, 'app'), { recursive: true });
writeFileSync(
  join(dir, 'app', 'child.ts'),
  `export function setup(_props: { tpl: (n: number) => Node }): Record<string, never> { return {}; }\n`
);
writeFileSync(join(dir, 'app', 'child.html'), `<div>{{ '' }}</div>\n`);
writeFileSync(
  join(dir, 'app', 'app.ts'),
  `import Child from './child';\nvoid Child;\nexport function setup(): Record<string, never> { return {}; }\n`
);
writeFileSync(
  join(dir, 'app', 'app.html'),
  `<Child tpl={{ rowTpl }} />\n@snippet rowTpl(n) {\n  <span>{{ n }}</span>\n}\n`
);

const diags = checkProject([dir]);
rmSync(dir, { recursive: true, force: true });

const snippetTypeErr = diags.find((d) => /not assignable to type '\(.*\) => Node'|'void' is not assignable/.test(d.message));
ok(!snippetTypeErr, `a @snippet satisfies a (row) => Node template prop — no spurious void-vs-Node error`);
ok(diags.length === 0, `no diagnostics at all for the valid snippet-as-template-prop (got ${diags.length})`);
if (diags.length) for (const d of diags) console.log(`      · ${d.message}`);

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ snippet-type smoke passed');
process.exit(failures ? 1 : 0);
