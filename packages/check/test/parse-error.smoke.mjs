/**
 * Node smoke test for @weave-framework/check — a template that fails to PARSE (e.g. a malformed
 * attribute) must surface as a normal `file:line:col` diagnostic, NOT abort `checkProject` with a
 * thrown parser stack (and never hang / OOM). Bundles the TS source on the fly (esbuild;
 * `typescript` external), writes temp fixtures, and runs `checkProject`.
 *
 * Run: `node packages/check/test/parse-error.smoke.mjs` (wired as `pnpm verify:check`).
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

// Bundle check (TS + @weave-framework/compiler) → a temp ESM module; keep `typescript` external.
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'check-for-test.mjs');
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

function fixture(html) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-check-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'app.ts'), 'export function setup(): Record<string, never> { return {}; }\n');
  writeFileSync(join(dir, 'app', 'app.html'), html);
  return dir;
}

console.log('\npackages/check/test/parse-error.smoke.mjs');

/* ---- a malformed attribute becomes a diagnostic, not a thrown stack ---- */
{
  const dir = fixture('<main>\n  <div }></div>\n</main>\n');
  let diags = null;
  let threw = '';
  try {
    diags = checkProject([dir]); // must NOT throw / hang
  } catch (e) {
    threw = e?.message ?? String(e);
  }
  rmSync(dir, { recursive: true, force: true });

  ok(threw === '', `checkProject returns instead of throwing on a bad template (threw: ${threw})`);
  const d = (diags ?? []).find((x) => /Unexpected character/.test(x.message));
  ok(!!d, 'a parse error surfaces as a diagnostic');
  if (d) {
    ok(d.category === 'error', 'the diagnostic is an error');
    ok(/app\.html$/.test(d.file.replace(/\\/g, '/')), `points at the .html file (got ${d.file})`);
    ok(d.line === 2 && d.col === 8, `precise location line 2, col 8 (got ${d.line}:${d.col})`);
    ok(/<div>/.test(d.message), 'names the enclosing tag');
  }
}

/* ---- a well-formed template produces no parse-error diagnostic ---- */
{
  const dir = fixture('<main>\n  <div class="ok"></div>\n</main>\n');
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  ok(!diags.some((x) => /Unexpected character/.test(x.message)), 'well-formed template: no parse-error diagnostic');
}

console.log(failures ? `\n✖ ${failures} check(s) failed\n` : '\n✓ all checks passed\n');
process.exit(failures ? 1 : 0);
