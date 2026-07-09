/**
 * Node smoke test for @weave-framework/check — auto-expose. A component whose `setup`
 * omits its `return` must still type-check: the checker synthesizes the same
 * `return { …template names }` the loader does, so `ReturnType<typeof setup>` exposes
 * exactly what the template reads. Guards two things at once:
 *   1. a valid return-less component produces ZERO diagnostics (without auto-expose,
 *      `__ctx.<name>` would fail against a `void` context type);
 *   2. types still FLOW through the synthesized return — a genuine type error in a
 *      template binding is still reported (auto-expose must not blanket-silence).
 *
 * Run: `node packages/check/test/auto-return.smoke.mjs` (wired into `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-auto-return-test.mjs');
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

console.log('\npackages/check/test/auto-return.smoke.mjs');

/** Run checkProject over a throwaway single-component project. */
function checkComponent(ts, html) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-autoret-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.ts'), ts);
  writeFileSync(join(dir, 'app', 'page.html'), html);
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

// 1. A valid return-less component — the template reads `count` + `label`, both declared
//    in setup but never returned. Auto-expose must synthesize the return → zero errors.
{
  const diags = checkComponent(
    `export function setup() {\n  const count = 3;\n  const label = () => 'hi';\n}\n`,
    `<b>{{ label() }}</b><i>{{ count }}</i>\n`
  );
  ok(diags.length === 0, `return-less component type-checks with no diagnostics (got ${diags.length})`);
  if (diags.length) for (const d of diags) console.log(`      · ${d.message}`);
}

// 2. Types still flow: `n` is a number, so `n.toUpperCase()` in the template must error —
//    proving the synthesized return carries real types, not `any`.
{
  const diags = checkComponent(
    `export function setup() {\n  const n = 42;\n}\n`,
    `<b>{{ n.toUpperCase() }}</b>\n`
  );
  const typed = diags.some((d) => /toUpperCase|does not exist on type 'number'/.test(d.message));
  ok(typed, `a real type error in a return-less component is still reported (got ${diags.length} diag(s))`);
}

// 3. An explicit return is unaffected (control) — still zero diagnostics.
{
  const diags = checkComponent(
    `export function setup() {\n  const count = 3;\n  return { count };\n}\n`,
    `<i>{{ count }}</i>\n`
  );
  ok(diags.length === 0, `explicit-return component still type-checks (got ${diags.length})`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ auto-return smoke passed');
process.exit(failures ? 1 : 0);
