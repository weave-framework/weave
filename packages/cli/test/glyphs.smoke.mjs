/**
 * Node smoke for CLI output a captured log can read.
 *
 * Reported from a real build log: every arrow and every dash of a `weave build` came out as mojibake —
 * `weave build ΓåÆ D:\…` and `(not type-checked ΓÇö run \`weave check\`)`. Nothing was wrong with the machine.
 * Node writes `→` as the UTF-8 bytes `e2 86 92`; MSBuild ran `npm run build` and CAPTURED the output, and the
 * capturing process decoded those bytes with its own code page. On a US-locale Windows that is CP437, where
 * `e2 86 92` reads as exactly `ΓåÆ`.
 *
 * So the rule under test: when the output is piped on Windows, the decoration is ASCII. Anywhere else, and in
 * any terminal, nothing changes — a pipe on Linux is UTF-8 by convention and those logs render fine.
 *
 * Run: `node packages/cli/test/glyphs.smoke.mjs` (wired as `pnpm verify:cli-glyphs`).
 */
import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:cli-glyphs — a captured build log stays readable\n');

const bundle = join(here, '.glyphs.bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'glyphs.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, packages: 'external',
});
const { ASCII_FALLBACK, toAscii, unicodeSafe } = await import(pathToFileURL(bundle).href);

/* ── the decision ──
   The Windows pipe is the ONLY case that changes, and it is the case the report came from. */
ok(unicodeSafe('win32', false, {}) === false, 'piped on Windows: ASCII — nobody knows how those bytes get decoded');
ok(unicodeSafe('win32', true, {}) === true, 'a Windows terminal is fine: the console owns the decoding');
ok(unicodeSafe('linux', false, {}) === true, 'a Linux pipe is fine: UTF-8 by convention');
ok(unicodeSafe('darwin', false, {}) === true, 'and so is a macOS pipe');
ok(unicodeSafe('linux', true, {}) === true, 'a Linux terminal is fine');

/* A build step that knows better than the heuristic can say so, either way. */
ok(unicodeSafe('linux', true, { WEAVE_ASCII: '1' }) === false, 'WEAVE_ASCII forces ASCII where the heuristic would not');
ok(unicodeSafe('win32', false, { WEAVE_UNICODE: '1' }) === true, 'WEAVE_UNICODE forces unicode where the heuristic would not');
ok(unicodeSafe('linux', true, { WEAVE_ASCII: '1', WEAVE_UNICODE: '1' }) === false, 'asked for both, the safe one wins');

/* ── the mapping ──
   Every character the CLI prints for decoration has a replacement; nothing else is touched. */
const DECOR = ['\u2192', '\u2014', '\u2022', '\u2026', '\u2713', '\u2716', '\u26a0', '\u00b7', '\u25b2'];
ok(DECOR.every((c) => ASCII_FALLBACK[c]), `every decorative character has a replacement (${Object.keys(ASCII_FALLBACK).length})`);
ok(DECOR.every((c) => !/[^\x00-\x7F]/.test(ASCII_FALLBACK[c])), 'and every replacement is itself ASCII');
ok(toAscii('weave build \u2192 dist/') === 'weave build -> dist/', `the reported line converts (${toAscii('weave build \u2192 dist/')})`);
ok(
  toAscii('(not type-checked \u2014 run `weave check`)') === '(not type-checked -- run `weave check`)',
  'and so does the other reported line',
);
// A path is content, not decoration. Mangling a name is a smaller harm than changing what the path says.
ok(toAscii('D:\\caf\u00e9\\app.ts') === 'D:\\caf\u00e9\\app.ts', 'a non-ASCII character we did not print is left alone');
ok(toAscii('plain ascii') === 'plain ascii', 'ASCII text is returned unchanged');

/* ── the real command, piped ──
   The function being right is not the claim; the claim is that the CLI's OUTPUT is readable. This runs the
   actual binary the way the build step does — captured, not attached to a terminal. */
const run = (env) =>
  execFileSync(process.execPath, [join(repo, 'packages', 'cli', 'bin', 'weave.mjs'), '--help'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, WEAVE_ASCII: '', WEAVE_UNICODE: '', ...env },
  });

const asciiRun = run({ WEAVE_ASCII: '1' });
const leftovers = DECOR.filter((c) => asciiRun.includes(c));
ok(asciiRun.length > 200, `the CLI printed something to check (${asciiRun.length} chars)`);
ok(leftovers.length === 0, `no decoration survives a captured run (${leftovers.map((c) => 'U+' + c.codePointAt(0).toString(16)).join(' ') || 'none'})`);
ok(![...asciiRun].some((c) => c.codePointAt(0) > 127), 'and not one byte above 127 in the whole of it');

const unicodeRun = run({ WEAVE_UNICODE: '1' });
ok(DECOR.some((c) => unicodeRun.includes(c)), 'a terminal run still gets the real characters — this is a fallback, not a removal');

rmSync(bundle, { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
