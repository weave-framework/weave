/**
 * Auto-expose and a hand-written `return` must resume identically.
 *
 * A component may omit `setup`'s `return` — the compiler writes it, from the names the template uses.
 * That is documented as a convenience with no other consequence. It had one: the resumable analysis
 * read the RAW script, so a component relying on auto-expose looked like it returned nothing, and an
 * imported `use:` action could not be shown to survive to the client. The whole subtree was refused
 * and client-rendered instead — silently, for writing less.
 *
 * Measured on real applications before fixing: `use:` actions were **18 of 29** resumable refusals
 * across 574 components, and every one of those components used auto-expose.
 *
 * The negative case is the point of the design and must survive: an action that genuinely cannot be
 * rebuilt on the client — a plain local function, which no snapshot carries — must still be refused,
 * because `applyAction` would otherwise call `undefined` on a resumed page.
 *
 * Run: `node packages/compiler/test/resume-auto-expose.smoke.mjs` (wired into `pnpm verify:resume-expose`).
 */
import { build } from 'esbuild';
import ts from 'typescript';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/compiler/test/resume-auto-expose.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-resume-expose-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { compileComponent } = await import(pathToFileURL(bundle).href);

const TEMPLATE = '<button use:tooltip={{ "hi" }}>{{ label() }}</button>\n';
const compile = (script) => compileComponent({ template: TEMPLATE, script }, { filename: 'probe.html', resumable: true, ts });
const warningsFor = (script) => compile(script).warnings ?? [];

const IMPORTS = [
  "import { signal } from '@weave-framework/runtime';",
  "import { tooltip } from '@weave-framework/ui/tooltip';",
  '',
].join('\n');

// 1. The form that already worked: the author writes the return themselves.
const explicit = warningsFor(
  IMPORTS +
    'export function setup(): { label: () => string; tooltip: typeof tooltip } {\n' +
    '  const n = signal(0);\n' +
    '  return { label: (): string => `count ${n()}`, tooltip };\n' +
    '}\n'
);
ok(explicit.length === 0, 'an explicit return adopts (got ' + JSON.stringify(explicit) + ')');

// 2. The same component, written the way the framework says you may write it.
const auto = warningsFor(
  IMPORTS +
    'export function setup() {\n' +
    '  const n = signal(0);\n' +
    '  const label = (): string => `count ${n()}`;\n' +
    '  // no return — auto-expose\n' +
    '}\n'
);
ok(auto.length === 0, 'and so does the same component under auto-expose (got ' + JSON.stringify(auto) + ')');

// 3. Not warning is not the same as working. The point is that `derive` REBUILDS the action on the
//    client and `adopt` applies it — a silent no-warning would satisfy the two checks above while the
//    resumed page still had no tooltip. An earlier version of this file asserted a refusal instead, on
//    a shape the compiler has been able to rebuild since E1.19; the assertion was invented, not measured.
const AUTO = [
  IMPORTS + 'export function setup() {',
  '  const n = signal(0);',
  '  const label = (): string => `count ${n()}`;',
  '  // no return — auto-expose',
  '}',
  '',
].join('\n');
const emitted = compile(AUTO).code;
ok(/ctx\.tooltip = tooltip/.test(emitted), 'and `derive` really rebuilds the action on the client');
ok(/applyAction\(_r, ctx\.tooltip/.test(emitted), 'and `adopt` applies it to the element it found');

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`resume-auto-expose smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('resume-auto-expose smoke passed\n');
