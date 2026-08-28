/**
 * `{{ count }}` instead of `{{ count() }}` — the mistake every signals framework's newcomer makes once.
 *
 * Weave used to render it: the page showed `() => { track(node); return node.value; }`, and nothing said
 * anything — not `weave check`, not `weave build`, not the runtime. The type was there for the taking the
 * whole time, so the harness now routes every text interpolation through a parameter type no callable can
 * satisfy, and the checker restates TypeScript's assignability wall as the one sentence that helps.
 *
 * The other half of this test matters just as much: everything that is NOT a function must stay silent,
 * including the positions where a function is exactly right (an event handler, a callback prop).
 *
 * Run: `node packages/check/test/interp-guard.smoke.mjs` (wired into `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-interp-guard-test.mjs');
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

console.log('\npackages/check/test/interp-guard.smoke.mjs');

// Fixtures live inside the repo so `@weave-framework/runtime` resolves — in the OS temp dir every
// case would fail on the import instead of on the thing under test.
function check(ts, html) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-interp-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'page.ts'), ts);
  writeFileSync(join(dir, 'app', 'page.html'), html);
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

const SETUP =
  "import { signal } from '@weave-framework/runtime';\n" +
  'export function setup() {\n' +
  '  const count = signal(0);\n' +
  '  const inc = () => count.set((n) => n + 1);\n' +
  '  const label = () => `n=${count()}`;\n' +
  '  const user = { name: "ada" };\n' +
  '  const items = [1, 2, 3];\n' +
  '  return { count, inc, label, user, items };\n' +
  '}\n';

// 1. The bug itself.
{
  const diags = check(SETUP, '<b>clicked {{ count }} times</b>\n');
  const d = diags[0];
  ok(diags.length === 1, `a signal read without () is one error (got ${diags.length})`);
  ok(/Call it/.test(d?.message ?? ''), `the message says to call it (got ${d?.message})`);
  ok(/Signal<number>/.test(d?.message ?? ''), `it names the type (got ${d?.message})`);
  ok(!/__weave|Argument of type|not assignable/.test(d?.message ?? ''), `and not the harness internals (got ${d?.message})`);
  // `<b>clicked {{ count …` — column 15 is the `c` of `count`, not the braces around it.
  ok(d?.line === 1 && d?.col === 15, `it lands on the expression itself (want 1:15, got ${d?.line}:${d?.col})`);
}

// 2. A plain getter — the same mistake without a signal.
{
  const diags = check(SETUP, '<b>{{ label }}</b>\n');
  ok(diags.length === 1 && /Call it/.test(diags[0].message), `a getter read without () is reported (got ${diags.length})`);
}

// 3. Everything that is not a function stays silent, in the same positions.
{
  const diags = check(
    SETUP,
    '<main>\n' +
      '  <b>{{ count() }}</b>\n' +
      '  <i>{{ label() }}</i>\n' +
      '  <u>{{ user.name }}</u>\n' +
      '  <s>{{ items.length }}</s>\n' +
      '  <em>{{ items }}</em>\n' + // an array stringifies; ugly, but legal and not this rule's business
      '  <button on:click={{ inc }}>x</button>\n' + // a function is exactly right here
      '  <p title={{ user.name }}>t</p>\n' +
      '</main>\n'
  );
  ok(diags.length === 0, `correct usage reports nothing (got ${JSON.stringify(diags.map((d) => d.message))})`);
}

// 4. A callback handed to a CHILD component is a function on purpose — never this error.
{
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-interp-child-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app', 'child.ts'), 'export function setup(props: { onDone: () => void }) {\n  return { done: props.onDone };\n}\n');
  writeFileSync(join(dir, 'app', 'child.html'), '<button on:click={{ done }}>ok</button>\n');
  writeFileSync(
    join(dir, 'app', 'page.ts'),
    "import Child from './child';\nvoid Child;\nexport function setup() {\n  const finish = (): void => {};\n  return { finish };\n}\n"
  );
  writeFileSync(join(dir, 'app', 'page.html'), '<Child onDone={{ finish }} />\n');
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  ok(diags.length === 0, `a callback prop is not flagged (got ${JSON.stringify(diags.map((d) => d.message))})`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ interpolation-guard smoke passed');
process.exit(failures ? 1 : 0);
