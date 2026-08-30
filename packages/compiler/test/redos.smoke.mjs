/**
 * Two compiler scans must stay LINEAR on hostile input.
 *
 * Both were polynomial, and both read text an author can make arbitrarily long — a component's own
 * script and a template's prose:
 *
 *   `import\s+([^;]*?)\s+from\s+['"][^'"]+['"]`  — `import` plus 8,000 spaces and no `from` took
 *                                                  59 SECONDS, because a run of whitespace can be
 *                                                  split between the two `\s+` and the lazy group in
 *                                                  every possible way.
 *   `@([A-Za-z]+)\s*(\([^{}]*\))?\s*\{`          — 120 KB of `@A(` took 5.7 seconds, for the same
 *                                                  reason across the optional group.
 *
 * The thresholds below are deliberately far above the fixed cost (tens of milliseconds) and far
 * below the broken one (seconds to minutes), so this cannot go red on a slow machine and cannot go
 * green on a reintroduced backtrack. Correctness is asserted alongside the timing — a scan that
 * stopped finding imports would also be fast.
 *
 * Run: `node packages/compiler/test/redos.smoke.mjs` (wired into `pnpm verify:redos`).
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else {
    console.log('+ ' + msg);
  }
};

console.log('\npackages/compiler/test/redos.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-redos-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { importsBinding, parseTemplate, lintTemplate } = await import(pathToFileURL(bundle).href);

const ms = (fn) => {
  const t = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};

/* ── 1. importsBinding still reads imports correctly ── */
ok(importsBinding(`import Child from './child';`, 'Child'), 'a default import names its binding');
ok(importsBinding(`import { A, Child } from './x';`, 'Child'), 'a named import names its binding');
ok(importsBinding(`import type { Child } from './x';`, 'Child'), 'a type-only import counts');
ok(!importsBinding(`import Other from './child';`, 'Child'), 'the module PATH is not the binding');
ok(!importsBinding(`import './child';`, 'Child'), 'a side-effect import binds nothing');
ok(!importsBinding(`const Child = 1;`, 'Child'), 'a plain declaration is not an import');

// Semicolon-less code is real, and a statement that ran to the next `;` would swallow both lines and
// only ever see the first binding.
ok(
  importsBinding(`import A from './a'\nimport Child from './child'\n`, 'Child'),
  'the SECOND of two imports written without semicolons is still found'
);

/* ── 2. importsBinding is linear on the input that took 59 seconds ── */
const hostileScript = 'import ' + ' '.repeat(8000);
const r1 = ms(() => importsBinding(hostileScript, 'Child'));
ok(r1.value === false, '`import` followed by whitespace imports nothing');
ok(r1.ms < 500, `8,000 spaces after \`import\` scan in ${r1.ms.toFixed(0)}ms (was 59,508ms)`);

/* ── 3. the text lint still reports a misspelled block ── */
const found = lintTemplate(parseTemplate('<div>@fro (t of todos()) { }</div>'));
ok(
  found.some((f) => f.includes('@fro') && f.includes('@for')),
  'a misspelled block head is still reported with its suggestion'
);
// A real block is consumed by the PARSER, so it never reaches this rule as text.
ok(
  !lintTemplate(parseTemplate('<div>@if (x) { hi }</div>')).some((f) => f.includes('not a Weave block')),
  'a block the parser recognises is not reported as leftover text'
);

/* ── 4. the text lint is linear on the input that took seconds ── */
for (const [name, text] of [
  ['`@A(` with no closing paren', '@A('.repeat(80000)],
  ['`@A` followed by whitespace', '@A' + ' '.repeat(240000)],
]) {
  const r = ms(() => lintTemplate(parseTemplate(`<div>${text}</div>`)));
  ok(r.ms < 1500, `240 KB of ${name} lints in ${r.ms.toFixed(0)}ms`);
}

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`redos smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('redos smoke passed\n');
