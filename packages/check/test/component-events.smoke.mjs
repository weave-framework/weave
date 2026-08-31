/**
 * `on:x={{ fn }}` on a component IS the prop `onX`, and `weave check` has to know that.
 *
 * The docs say the two spellings are the same prop, and the compiler agrees — `emitComponent` in codegen
 * pushes `on:close` into the props object as `onClose` via `onProp()`. The checker did not: its comment
 * read "events stay outside the contract (the runtime wires them)", which describes a runtime that does
 * not exist. So a child declaring `onAdd` as a required prop, given `on:add={{ fn }}` by its parent,
 * reported TS2345 "Property 'onAdd' is missing" — on a page whose whole subject is that these are the
 * same thing, and on code that builds and runs correctly.
 *
 * Found by writing a demo for the Components page, not by a test: the demo used the documented `on:`
 * form and `weave check` rejected it.
 *
 * Run: `node packages/check/test/component-events.smoke.mjs` (wired into `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-component-events.mjs');
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

console.log('\npackages/check/test/component-events.smoke.mjs');

function check(files) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-events-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return diags;
}
const codes = (d) => JSON.stringify(d.map((x) => `${x.code}: ${x.message.split('\n')[0]}`));

const CHILD_TS =
  'interface P { step: number; onAdd: (n: number) => void }\n' +
  'export function setup(props: P) {\n' +
  '  const step = (): number => props.step;\n' +
  '  const send = (): void => props.onAdd(1);\n' +
  '}\n';
const CHILD_HTML = '<button type="button" on:click={{ send }}>+{{ step() }}</button>\n';
const parentTs =
  "import Child from '../child/child';\nvoid Child;\n" +
  'export function setup() {\n  const onAdd = (n: number): void => { void n; };\n  const step = 1;\n}\n';

const app = (parentHtml) => ({
  'child/child.ts': CHILD_TS,
  'child/child.html': CHILD_HTML,
  'parent/parent.ts': parentTs,
  'parent/parent.html': parentHtml,
});

// 1. The `on:` spelling satisfies the prop — the whole point.
{
  const d = check(app('<Child step={{ step }} on:add={{ onAdd }} />\n'));
  ok(d.length === 0, `on:add satisfies the required onAdd prop (got ${codes(d)})`);
}

// 2. The plain spelling still does. If this breaks, the fix traded one bug for another.
{
  const d = check(app('<Child step={{ step }} onAdd={{ onAdd }} />\n'));
  ok(d.length === 0, `onAdd still satisfies it (got ${codes(d)})`);
}

// 3. THE CONTROL. Omit the handler entirely and the error must still fire — otherwise cases 1 and 2
//    would be green because nothing is checked, which is exactly how this kind of fix goes vacuous.
{
  const d = check(app('<Child step={{ step }} />\n'));
  ok(
    d.some((x) => x.code === 2345 || x.code === 2739 || x.code === 2741),
    `a MISSING handler is still an error (got ${codes(d)})`
  );
}

// 4. A handler of the wrong shape must be caught through the `on:` spelling too, or the prop is being
//    accepted without being typed.
{
  const d = check({
    ...app('<Child step={{ step }} on:add={{ badHandler }} />\n'),
    'parent/parent.ts':
      "import Child from '../child/child';\nvoid Child;\n" +
      'export function setup() {\n  const badHandler = (s: string): void => { void s; };\n  const step = 1;\n}\n',
  });
  // 2322 rather than 2345: with the event in the props object TypeScript compares the two function
  // types directly and names both, which is a better message than "argument not assignable". I asserted
  // 2345 here from the pre-fix shape and was wrong — the diagnostic improved.
  ok(
    d.some((x) => x.code === 2322 || x.code === 2345),
    `a wrongly-typed on: handler is caught (got ${codes(d)})`
  );
}

// 5. THE OTHER HALF. A child that does NOT declare the handler is equally correct: `defineComponent`
//    forwards an undeclared `on:x` to the rendered root element as a DOM listener, which is how
//    `<Button on:click={{ fn }}>` works and why `ButtonProps` has no `onClick`. The first version of
//    this fix emitted events inline and produced 78 TS2353s across this repository's own documentation,
//    every one on markup that builds and runs. Without this case that regression ships.
{
  const d = check({
    'child/child.ts':
      'interface P { step: number }\nexport function setup(props: P) {\n  const step = (): number => props.step;\n}\n',
    'child/child.html': '<button type="button">{{ step() }}</button>\n',
    'parent/parent.ts': parentTs,
    'parent/parent.html': '<Child step={{ step }} on:click={{ onAdd }} />\n',
  });
  ok(d.length === 0, `an on: handler the child does not declare is forwarded, not an error (got ${codes(d)})`);
}

rmSync(out, { force: true });

console.log('\n----------------------------------------');
if (failures) {
  console.error(`component-events smoke FAILED (${failures})\n`);
  process.exit(1);
}
console.log('component-events smoke passed\n');
