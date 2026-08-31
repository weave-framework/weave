/**
 * `weave check --fix` — the fix a rule is certain of, actually applied.
 *
 * Three template mistakes that used to reach the author only as prose, and only during a build:
 * `weave check` said nothing about any of them, so the checker and the build disagreed about whether
 * the same file was fine. Now check reports them, and --fix repairs the ones with exactly one answer.
 *
 * The assertion is the OUTCOME, not the offer: the file must end up byte-identical to the correct
 * source. Three fixes land in one file, so this also covers the back-to-front ordering -- applied
 * front-to-back, the first edit would shift every later offset and the last two would corrupt the file.
 *
 * Run: `node packages/cli/test/check-fix.smoke.mjs` (wired into `pnpm verify:check-fix`).
 */
import { build as esbuild } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

console.log('\npackages/cli/test/check-fix.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-check-fix-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { main } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

const app = mkdtempSync(join(repo, 'tools', '.verify-check-fix-app-'));
const dir = join(app, 'src', 'app');
mkdirSync(dir, { recursive: true });

writeFileSync(
  join(dir, 'app.ts'),
  'export function setup(): { inc: () => void; items: () => string[] } {\n' +
    '  return { inc: (): void => {}, items: (): string[] => [] };\n' +
    '}\n'
);

const BROKEN =
  '<div>\n' +
  '  <button onclick={{ inc }}>a</button>\n' +
  '  <button on:clik={{ inc }}>b</button>\n' +
  '  @fro (t of items()) { <i>{{ t }}</i> }\n' +
  '</div>\n';
const FIXED =
  '<div>\n' +
  '  <button on:click={{ inc }}>a</button>\n' +
  '  <button on:click={{ inc }}>b</button>\n' +
  '  @for (t of items()) { <i>{{ t }}</i> }\n' +
  '</div>\n';

const html = join(dir, 'app.html');
writeFileSync(html, BROKEN);

/** Run the CLI in the fixture, capturing what it prints and the code it would have exited with. */
const run = async (args) => {
  const said = [];
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const cwd = process.cwd();
  let code = 0;
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  // `main` exits the process on errors; record the code and unwind instead of killing the test.
  process.exit = (c) => {
    code = c ?? 0;
    throw new Error('__exit__');
  };
  process.chdir(app);
  try {
    await main(args);
  } catch (e) {
    if (!String(e && e.message).includes('__exit__')) throw e;
  } finally {
    process.chdir(cwd);
    console.log = realLog;
    console.error = realErr;
    process.exit = realExit;
  }
  return { said, code };
};

// 0. The root actually given on the command line is the root that gets checked. This is not a detail:
// `weave check <path>` used to drop its first path argument, so it checked `src` whatever you asked for
// -- and in a project with no `src` it checked NOTHING and printed "no type errors". A false green from
// the quality tool is worse than no quality tool. `lib` here is deliberately not `src`.
const libDir = join(app, 'lib', 'thing');
mkdirSync(libDir, { recursive: true });
writeFileSync(join(libDir, 'thing.ts'), 'export const broken: number = "not a number";' + String.fromCharCode(10));
const rooted = await run(['check', 'lib']);
ok(rooted.code === 1, 'a root that is not `src` is really checked (exit ' + rooted.code + ')');
ok(
  rooted.said.some((l) => l.includes('thing.ts')),
  'and the error is reported from it (got ' + JSON.stringify(rooted.said) + ')',
);
rmSync(join(app, 'lib'), { recursive: true, force: true });

// 1. Plain `check` must REPORT all three -- before this they were invisible to the checker.
const first = await run(['check']);
const reported = first.said.filter((l) => l.includes('app.html') && l.includes('warning'));
ok(reported.length === 3, 'plain check reports all three (got ' + reported.length + ': ' + JSON.stringify(first.said) + ')');
ok(readFileSync(html, 'utf8') === BROKEN, 'and changes nothing without --fix');

// 2. `--fix` repairs them, back to front -- applied the other way the first edit would shift the rest.
const second = await run(['check', '--fix']);
ok(second.said.some((l) => l.includes('repaired 3')), 'it says it repaired three (got ' + JSON.stringify(second.said) + ')');
ok(readFileSync(html, 'utf8') === FIXED, 'and the file is byte-identical to the correct source');

// 3. Nothing left to do, and the second run must not touch the file.
const third = await run(['check', '--fix']);
ok(third.said.some((l) => l.includes('nothing to repair')), 'a second run has nothing to repair');
ok(readFileSync(html, 'utf8') === FIXED, 'and leaves the file exactly as it was');
/* 4. SEVERAL missing names must all be declared by ONE `--fix`.
      `grow-setup` inserts every declaration at the same offset — the end of `setup`'s body — so they all
      overlap, and `applyFixes` skips a fix overlapping one already applied. With a single apply-then-
      recheck round that meant a template naming four missing things got two of them, printed the rest as
      errors, and looked broken. Measured before the loop landed: `save` and `done` on the first run,
      `name` and `age` only on a second. */
{
  const many = mkdtempSync(join(repo, 'tools', '.verify-check-fix-many-'));
  const d2 = join(many, 'src', 'app');
  mkdirSync(d2, { recursive: true });
  const NL = String.fromCharCode(10);
  writeFileSync(join(d2, 'app.ts'), ['export function setup() {', '  const n = 1;', '  void n;', '}', ''].join(NL));
  writeFileSync(
    join(d2, 'app.html'),
    [
      '<div>',
      '  <button type="button" on:click={{ save }}>save</button>',
      '  <input type="checkbox" bind:checked={{ done }} />',
      '  <input type="number" bind:value={{ age }} />',
      '  <input bind:value={{ label }} />',
      '</div>',
      '',
    ].join(NL)
  );
  // `run` chdirs into the FIRST fixture, so this one is reached by an explicit path rather than by cwd.
  const r = await run(['check', d2, '--fix']);
  const grown = readFileSync(join(d2, 'app.ts'), 'utf8');
  for (const [name, decl] of [
    ['save', 'const save = (): void =>'],
    ['done', "const done = signal(false)"],
    ['age', 'const age = signal(0)'],
    ['label', "const label = signal('')"],
  ]) {
    ok(grown.includes(decl), `one --fix run declares ${name} (${decl})`);
  }
  ok(grown.includes("import { signal } from '@weave-framework/runtime'"), 'and brings the signal import with it');
  void r;
  rmSync(many, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' check-fix check(s) failed\n');
  process.exit(1);
}
console.log('\n+ weave check reports template mistakes, and --fix repairs the certain ones\n');
process.exit(0);
