/**
 * A component that provides a child's name ITSELF must not have one synthesized for it.
 *
 * `weave check` writes an `import <Tag> from …` for every `<Tag>` a template composes, unless the
 * script already imports it. "Already imports" was too narrow a question: a component can also
 * DECLARE the name — a wrapper that does `const Chart = (ChartModule as …).default` and re-exports it
 * is a real pattern, and the synthesized import then collided with the author's own declaration:
 *
 *     error TS2440: [generated] Import declaration conflicts with local declaration of 'Chart'.
 *
 * The `[generated]` marker is the tell: the error is on a line the checker wrote, in a file the author
 * cannot edit. The build has no such error, and `weave check` disagreeing with the build about child
 * components is exactly the failure 3.2.0 closed once already.
 *
 * Found by running the checker against a real application. Two shapes are covered here — declared, and
 * imported under another name and renamed — plus the case that must keep working: a template composing
 * a child the script says nothing about, which still gets its import.
 *
 * Run: `node packages/check/test/local-binding.smoke.mjs` (wired into `pnpm verify:local-binding`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/check/test/local-binding.smoke.mjs');

const dir = join(repo, 'examples', '__fixtures__', '.verify-local-binding');
const CHILD = 'export const template: string = `<div class="chart"></div>`;\nexport function setup(): Record<string, never> {\n  return {};\n}\n';

/** Write a fixture whose `metric.ts` is `script`, then run the real `weave check` over it. */
const checkWith = (script) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'chart'), { recursive: true });
  mkdirSync(join(dir, 'metric'), { recursive: true });
  writeFileSync(join(dir, 'chart', 'chart.ts'), CHILD);
  writeFileSync(join(dir, 'metric', 'metric.ts'), script);
  writeFileSync(join(dir, 'metric', 'metric.html'), '<div>\n  <Chart />\n</div>\n');
  try {
    return execFileSync(process.execPath, [join(repo, 'packages/cli/bin/weave.mjs'), 'check', dir], {
      cwd: repo,
      encoding: 'utf8',
    });
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

// 1. The shape a real app had: imported as a namespace, then declared under the tag's name.
const declared = checkWith(
  "import * as ChartModule from '../chart/chart.js';\n" +
    'const Chart = (ChartModule as unknown as { default: (props: Record<string, unknown>) => Node }).default;\n' +
    'export function setup(): { Chart: typeof Chart } {\n  return { Chart };\n}\n' +
    'export { Chart };\n'
);
ok(!/TS2440/.test(declared), 'a locally DECLARED child name gets no synthesized import: ' + JSON.stringify(declared.trim().slice(0, 120)));
ok(/no type errors/.test(declared), 'and the component checks clean');

// 2. Renamed on the way in — also a binding the script provides.
const renamed = checkWith(
  "import { default as Chart } from '../chart/chart.js';\n" +
    'export function setup(): { Chart: typeof Chart } {\n  return { Chart };\n}\n'
);
ok(!/TS2440/.test(renamed), 'so does one imported under another name: ' + JSON.stringify(renamed.trim().slice(0, 120)));

// 3. The case that must keep working, or this "fix" is just a way to stop importing anything.
const silent = checkWith('export function setup(): Record<string, never> {\n  return {};\n}\n');
ok(
  /no type errors/.test(silent),
  'a child the script says NOTHING about still gets its import: ' + JSON.stringify(silent.trim().slice(0, 120))
);

rmSync(dir, { recursive: true, force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`local-binding smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('local-binding smoke passed\n');
