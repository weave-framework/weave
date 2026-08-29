/**
 * The template as a specification: a name it uses, declared into `setup` by `weave check --fix`.
 *
 * A component is two files and you say every name twice — once where you use it, once where you
 * define it. One mirror is already gone (auto-expose writes the `return`). This removes the other,
 * and ONLY where the markup says without doubt what the missing thing is.
 *
 * So the gate has two halves, and the second matters more than the first:
 *   1. `on:click={{ save }}` with no `save` — declared, added to the return mirror, and added to the
 *      declared return TYPE, all in one edit, leaving the file byte-identical to what a person would
 *      have written. The check goes from an error to clean in a single run.
 *   2. `{{ total }}` with no `total` — could be a string, a number, a signal, anything. Nothing is
 *      offered, nothing is written. A tool that guesses here is one people switch off, and a guard
 *      that is never tested is a guard that quietly stops holding.
 *
 * Run: `node packages/cli/test/grow-setup.smoke.mjs` (wired into `pnpm verify:grow-setup`).
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
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/grow-setup.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-grow-setup-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-grow-setup-app-'));
const dir = join(app, 'src', 'app');
mkdirSync(dir, { recursive: true });
const tsPath = join(dir, 'app.ts');
const htmlPath = join(dir, 'app.html');

const run = async (args) => {
  const said = [];
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const cwd = process.cwd();
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  process.exit = () => {
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
  return said;
};

// ── 1. the unambiguous case ──────────────────────────────────────────────────────────────────────
const TS = 'export function setup(): { n: number } {\n  const n = 1;\n  return { n };\n}\n';
const WANT =
  'export function setup(): { n: number; save: () => void } {\n' +
  '  const n = 1;\n' +
  '  const save = (): void => {\n' +
  '    // TODO\n' +
  '  };\n' +
  '  return { n, save };\n' +
  '}\n';
writeFileSync(tsPath, TS);
writeFileSync(htmlPath, '<div>\n  <p>{{ n }}</p>\n  <button on:click={{ save }}>Save</button>\n</div>\n');

const before = await run(['check']);
ok(
  before.some((l) => l.includes('app.html') && l.includes("Property 'save' does not exist")),
  'the template asking for a name it has not got is an error (got ' + JSON.stringify(before) + ')'
);

const fixed = await run(['check', '--fix']);
ok(fixed.some((l) => l.includes('repaired 1')), 'one repair (got ' + JSON.stringify(fixed) + ')');
ok(readFileSync(tsPath, 'utf8') === WANT, 'the .ts is byte-identical to what a person would write:\n     got  ' + JSON.stringify(readFileSync(tsPath, 'utf8')) + '\n     want ' + JSON.stringify(WANT));
ok(fixed.some((l) => l.includes('no type errors')), 'and the project type-checks clean in the same run');

// ── 2. the ambiguous case: nothing is guessed ────────────────────────────────────────────────────
writeFileSync(tsPath, TS);
writeFileSync(htmlPath, '<div>\n  <p>{{ n }} {{ total }}</p>\n</div>\n');
const amb = await run(['check', '--fix']);
ok(amb.some((l) => l.includes('nothing to repair')), 'a value of unknown shape is not guessed (got ' + JSON.stringify(amb) + ')');
ok(readFileSync(tsPath, 'utf8') === TS, 'and the .ts is untouched');
ok(amb.some((l) => l.includes("Property 'total' does not exist")), 'the error still stands, so nothing is hidden');

// ── 3. a NAMED return type is somebody else's declaration — decline ──────────────────────────────
const NAMED = 'interface S {\n  n: number;\n}\nexport function setup(): S {\n  const n = 1;\n  return { n };\n}\n';
writeFileSync(tsPath, NAMED);
writeFileSync(htmlPath, '<div>\n  <button on:click={{ save }}>Save</button>\n</div>\n');
const named = await run(['check', '--fix']);
ok(named.some((l) => l.includes('nothing to repair')), 'a named return type is not reached into (got ' + JSON.stringify(named) + ')');
ok(readFileSync(tsPath, 'utf8') === NAMED, 'and that .ts is untouched too');

// 4. a return type that is NOT a type literal, but does carry braces. Without the guard the naive
//    first-`{`-to-last-`}` rewrite mangles it into nonsense, so this is what proves the guard.
const UNION = 'export function setup(): { n: number } | { m: number } {' + String.fromCharCode(10) +
  '  const n = 1;' + String.fromCharCode(10) +
  '  return { n };' + String.fromCharCode(10) +
  '}' + String.fromCharCode(10);
writeFileSync(tsPath, UNION);
writeFileSync(htmlPath, '<div>' + String.fromCharCode(10) + '  <button on:click={{ save }}>Save</button>' + String.fromCharCode(10) + '</div>' + String.fromCharCode(10));
const union = await run(['check', '--fix']);
ok(union.some((l) => l.includes('nothing to repair')), 'a return type that is not a type literal is left alone (got ' + JSON.stringify(union) + ')');
ok(readFileSync(tsPath, 'utf8') === UNION, 'and it is not mangled');

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' grow-setup check(s) failed\n');
  process.exit(1);
}
console.log('\n+ the template grows the .ts where it is certain, and declines where it is not\n');
process.exit(0);
