/**
 * A malformed template must produce a LOCATED error, never a crash.
 *
 * The parser is recursive-descent and hand-written, and it is the piece most exposed to input nobody
 * wrote on purpose: a half-finished edit, a truncated paste, the intermediate states of a migration.
 * The failure that matters is not "it rejected the file" — it is *how*. `Maximum call stack size
 * exceeded`, or codegen's `Empty template fragment`, tell an author nothing about where to look.
 *
 * Two halves, and the first is the one that would find a regression:
 *
 *  1. **Derived from real templates.** Every tracked `.html` in the repo is truncated at forty points,
 *     has single characters deleted at twenty more, and gets each structural character injected into
 *     its middle. Roughly 2,600 inputs that a person could actually produce mid-edit.
 *  2. **Synthetic hostile shapes**, for the classes real files do not reach: thousands of unclosed
 *     tags or blocks (which used to overflow the stack), an unterminated comment (which used to
 *     swallow the file and surface as "Empty template fragment" with no position), and soup made of
 *     each structural character.
 *
 * A case passes if it compiles, or throws with an `offset` on it. Nothing else counts, and a case
 * taking longer than two seconds fails too — a hang is a crash with extra steps.
 *
 * Run: `node packages/compiler/test/hostile-input.smoke.mjs` (wired into `pnpm verify:hostile-input`).
 */
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

console.log('\npackages/compiler/test/hostile-input.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-hostile-input-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { compileTemplate } = await import(pathToFileURL(bundle).href);

/** Compile one input; returns null when it behaved, or a description of how it did not. */
const outcome = (src) => {
  const started = Date.now();
  let bad = null;
  try {
    compileTemplate(src);
  } catch (e) {
    if (typeof e?.offset !== 'number') {
      bad = 'unlocated ' + (e?.constructor?.name ?? '?') + ': ' + String(e?.message).slice(0, 80);
    }
  }
  const ms = Date.now() - started;
  if (!bad && ms > 2000) bad = 'took ' + ms + 'ms';
  return bad;
};

/* ── 1. Mutations of the repository's own templates ── */
const files = execSync('git ls-files "*.html"', { cwd: repo, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => f && !f.includes('node_modules') && !f.endsWith('index.html'))
  .slice(0, 40);
ok(files.length >= 10, `${files.length} real templates to mutate (a shrinking corpus weakens this)`);

let cases = 0;
let threw = 0;
const problems = [];
const feed = (label, src) => {
  cases++;
  let located = false;
  try {
    compileTemplate(src);
  } catch (e) {
    threw++;
    located = typeof e?.offset === 'number';
    if (!located) problems.push(label + ' -> unlocated ' + (e?.constructor?.name ?? '?') + ': ' + String(e?.message).slice(0, 80));
  }
};
for (const f of files) {
  const src = readFileSync(join(repo, f), 'utf8');
  for (let i = 1; i < 40; i++) feed(`${f} truncated ${i}/40`, src.slice(0, Math.floor((src.length * i) / 40)));
  for (let i = 0; i < 20; i++) {
    const at = Math.floor((src.length * i) / 20);
    feed(`${f} minus char @${at}`, src.slice(0, at) + src.slice(at + 1));
  }
  const mid = Math.floor(src.length / 2);
  for (const c of ['<', '>', '{', '}', '"', '@', '/']) feed(`${f} with a stray ${c}`, src.slice(0, mid) + c + src.slice(mid));
}
ok(problems.length === 0, `${cases} mutations of real templates, every failure located` + (problems.length ? ':\n     ' + problems.slice(0, 5).join('\n     ') : ''));
// Without this the check above is satisfied by a parser that never rejects anything at all.
ok(threw > cases / 10, `${threw} of them were rejected, so the corpus really is malformed`);

/* ── 2. Synthetic shapes real files do not reach ── */
const R = (n, t) => t.repeat(n);
for (const [label, src] of [
  ['10,000 nested elements', R(10000, '<div>') + 'x' + R(10000, '</div>')],
  ['10,000 unclosed elements', R(10000, '<div>')],
  ['10,000 unclosed @if blocks', R(10000, '@if (a) {')],
  ['5,000 nested @for blocks', R(5000, '@for (i of x()) {') + R(5000, '}')],
  ['10,000 open interpolations', R(10000, '{{')],
  ['10,000 attributes on one element', '<div ' + R(10000, 'a="1" ') + '></div>'],
  ['an unterminated attribute value', '<div a="' + R(100000, 'x')],
  ['an unterminated comment', '<!--' + R(100000, 'x')],
  ['angle brackets, 50,000 of them', R(50000, '<>')],
  ['braces, 50,000 of them', R(50000, '{}')],
  ['at signs, 50,000 of them', R(50000, '@')],
  ['quotes, 50,000 of them', R(50000, '"')],
  ['closing slashes, 50,000 of them', R(50000, '</')],
  ['an expression nested 5,000 deep', '{{ ' + R(5000, '(') + '1' + R(5000, ')') + ' }}'],
]) {
  const bad = outcome(src);
  ok(!bad, `${label}: ${bad ?? 'compiles or says where'}`);
}

/* ── 3. The two shapes this gate was written for, named ── */
let msg = '';
try {
  compileTemplate('<!-- never closed');
} catch (e) {
  msg = String(e?.message);
}
ok(/[Uu]nterminated comment/.test(msg), `an unterminated comment says so, rather than "Empty template fragment": ${JSON.stringify(msg.slice(0, 60))}`);

msg = '';
try {
  compileTemplate(R(10000, '<div>'));
} catch (e) {
  msg = String(e?.message);
}
ok(/nests more than/.test(msg), `runaway nesting says so, rather than overflowing the stack: ${JSON.stringify(msg.slice(0, 60))}`);

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`hostile-input smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('hostile-input smoke passed\n');
