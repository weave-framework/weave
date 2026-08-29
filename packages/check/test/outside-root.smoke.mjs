/**
 * A component imported from OUTSIDE the checked roots.
 *
 * A Weave component's default export is synthesized by the compiler, so the `.ts` on disk genuinely
 * does not have one. The checker built virtuals only for components under the roots, so every import
 * of a component from anywhere else — a shared package, a sibling library, a directory the command was
 * simply not pointed at — was reported as `has no default export`. On this repo's own docs site that
 * was **396 errors on correct code**, which is how a team learns to stop running the checker.
 *
 * The second case is the one that matters. Silencing the error would be easy and wrong: the point is
 * that the imported component is really TYPED, so a wrong prop handed to it across the boundary is
 * still caught.
 *
 * Run: `node packages/check/test/outside-root.smoke.mjs` (wired into `pnpm verify:check`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
const out = join(cacheDir, 'check-for-outside-root-test.mjs');
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

console.log('\npackages/check/test/outside-root.smoke.mjs');

/** A project with a `lib/` component and an `app/` that imports it. Only `app/` is checked. */
function checkApp(appTs) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-outside-'));
  const write = (rel, text) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write(
    'lib/badge/badge.ts',
    'export function setup(props: { count: number }): { count: number } {\n' +
      '  return { count: props.count };\n' +
      '}\n'
  );
  write('lib/badge/badge.html', '<span>{{ count }}</span>\n');
  write('app/page.ts', appTs);
  write('app/page.html', '<div><Badge count={{ n() }} /></div>\n');
  const diags = checkProject([join(dir, 'app')]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return diags;
}

const GOOD =
  'import Badge from "../lib/badge/badge";\n' +
  'import { signal, type Signal } from "@weave-framework/runtime";\n' +
  'void Badge;\n' +
  'export function setup(): { n: Signal<number> } {\n' +
  '  return { n: signal(1) };\n' +
  '}\n';

// 1. The import itself must be clean — the component is outside the roots, and that is normal.
{
  const diags = checkApp(GOOD);
  const noDefault = diags.filter((d) => /has no default export/.test(d.message));
  ok(noDefault.length === 0, 'a component imported from outside the roots is not "has no default export"');
  ok(
    diags.filter((d) => d.category === 'error').length === 0,
    'and the project is clean (got ' + JSON.stringify(diags.map((d) => d.message)) + ')'
  );
}

// 2. And it is genuinely typed: the wrong prop type across that boundary is still an error. Without
// this, silencing case 1 would pass and the checker would have gone blind at every package edge.
{
  const wrong = checkApp(
    'import Badge from "../lib/badge/badge";\n' +
      'import { signal, type Signal } from "@weave-framework/runtime";\n' +
      'void Badge;\n' +
      'export function setup(): { n: Signal<string> } {\n' +
      '  return { n: signal("one") };\n' +
      '}\n'
  );
  ok(
    wrong.some((d) => d.category === 'error' && /not assignable to type 'number'/.test(d.message)),
    'a string handed to its `count` prop is still caught (got ' + JSON.stringify(wrong.map((d) => d.message)) + ')'
  );
}

if (failures) {
  console.error(`\n✖ ${failures} outside-root check(s) failed\n`);
  process.exit(1);
}
console.log('\n✔ components imported from outside the checked roots are typed, not errors\n');
process.exit(0);
