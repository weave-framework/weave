/**
 * The scaffold's first component is the quick start's first component.
 *
 * `npm create weave` writes `src/app/app.ts`, and the quick-start page shows `src/app/app.ts`. They were
 * two different files: the page taught the short form — no `return`, no annotations, the compiler
 * exposes what the template reads — while the scaffold shipped
 * `export function setup(): { count: Signal<number>; inc: () => void }` with a hand-written `return`.
 * The first file a newcomer opens contradicted the first page they read, and the heavier one is the
 * one they copy, because it is the one on their disk.
 *
 * Two assertions, and both are needed:
 *  1. the scaffold's `app.ts` is byte-for-byte the quick start's `src/app/app.ts` block, so neither can
 *     drift without the other;
 *  2. that file COMPILES through the real component loader and the template still reaches `count` and
 *     `inc` — the short form only works because the compiler synthesizes the return, so a scaffold that
 *     relies on it has to be proven to get one.
 *
 * Run: `pnpm verify:scaffold-docs` (or `node tools/verify-scaffold-docs.mjs`).
 */
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\ntools/verify-scaffold-docs.mjs');

const page = readFileSync(join(root, 'docs/src/content/learn/quick-start.md'), 'utf8');
const scaffoldDir = join(root, 'packages/create-weave/template/src/app');
const script = readFileSync(join(scaffoldDir, 'app.ts'), 'utf8');
const template = readFileSync(join(scaffoldDir, 'app.html'), 'utf8');

/* ── 1. the same file ── */
const fence = /~~~ts title="src\/app\/app\.ts"\n([\s\S]*?)\n~~~/.exec(page);
ok(!!fence, 'the quick start shows a `src/app/app.ts` block');
const shown = fence ? fence[1].trim() : '';
ok(
  shown === script.trim(),
  'the scaffold app.ts is the quick-start app.ts' +
    (shown === script.trim() ? '' : `\n  --- quick start ---\n${shown}\n  --- scaffold ---\n${script.trim()}`)
);
ok(!/\breturn\b/.test(script), 'the scaffold setup() has no hand-written return (the compiler writes it)');

/* ── 2. and it compiles into a component the template can read ── */
const bundle = join(root, 'tools', '.verify-scaffold-docs-bundle.mjs');
await build({
  entryPoints: [join(root, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['typescript'],
});
process.on('exit', () => rmSync(bundle, { force: true }));
const { compileComponent } = await import(pathToFileURL(bundle).href);

let compiled = null;
try {
  compiled = compileComponent({ script, template }, { filename: join(scaffoldDir, 'app.ts') });
} catch (e) {
  ok(false, `the scaffold component compiles (threw: ${e?.message ?? e})`);
}
if (compiled) {
  ok(/return \{[^}]*\bcount\b[^}]*\}/.test(compiled.code), 'the synthesized return exposes `count`');
  ok(/return \{[^}]*\binc\b[^}]*\}/.test(compiled.code), 'the synthesized return exposes `inc`');
  ok(/bindText\(/.test(compiled.code), 'the template reads the signal reactively (`bindText`), not once');
  ok(/listen\([^)]*"click"/.test(compiled.code), 'the click handler is wired');
}

if (failed) {
  console.error(`\nX ${failed} scaffold/docs check(s) failed\n`);
  process.exit(1);
}
console.log('\n+ the scaffold and the quick start show the same first component, and it compiles\n');
