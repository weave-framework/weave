/**
 * Node smoke for `@weave-framework/migrate` widening — reading every LOCAL library an application reaches.
 *
 * This gate exists because of a defect a reader found on screen, not in a test: a component sat on the canvas
 * with no connection to anything, and 54 workspace libraries — every one of them present on disk — had been
 * marked "opened" without a single file being read. Two habits caused it, and both are guarded here.
 *
 *   grouped    — several aliases resolving to ONE folder were deduplicated by folder, so the first alias was
 *                read and the rest were marked opened and dropped. The fixture puts two module barrels under
 *                one application: both services must come back, not just the first.
 *   barrel     — a path alias resolves to an exact FILE, and that file was thrown away in favour of
 *                `findEntryPoint(folder)`, which for a module inside an application answers `src/main.ts`.
 *                Neither barrel would be opened at all, so neither service would be found.
 *
 * Run: `node packages/migrate/test/opening.smoke.mjs` (wired as `pnpm verify:migrate-opening`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const app = join(here, 'fixtures', 'alias-modules', 'app');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-opening — every local library behind an alias is actually read\n');

const bundle = join(here, '.opening.bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'migrate', 'src', 'analyze.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, packages: 'external',
});
const { assembleFacts, assembleFactsOpening, assembleFactsOpeningAsync } = await import(pathToFileURL(bundle).href);

// Before widening: the app names both libraries and has read neither.
const shallow = assembleFacts(app);
ok(shallow.entry !== null, `the fixture application has an entry point (${shallow.entry ? 'found' : 'NOT FOUND'})`);
ok(shallow.services.length === 0, `first pass reads no library service (read ${shallow.services.length})`);

// After widening: BOTH aliases resolve to their own barrel and both services come back.
const full = assembleFactsOpening(app, ['*']);
const names = full.services.map((s) => s.className).sort();
ok(names.includes('OneService'), `the first alias is read (services: ${names.join(', ') || 'none'})`);
ok(names.includes('TwoService'), 'the SECOND alias under the same folder is read too, not dropped as a duplicate');

// The barrels themselves must be among the files walked — that is what "the alias file is the entry" means.
const slash = String.fromCharCode(92);
const read = full.files.map((f) => f.split(slash).join('/').toLowerCase());
ok(read.some((f) => f.endsWith('one/one.service.ts')), 'the walk reached through the first barrel to its source');
ok(read.some((f) => f.endsWith('two/two.service.ts')), 'the walk reached through the second barrel to its source');

// A library reached only through another library proves the widening keeps going past the first round.
ok(read.some((f) => f.endsWith('four/src/four.service.ts')), 'a library behind another library is reached in a later round');

/* Progress must only ever move forwards. Reading reveals more libraries, so the work is discovered as it goes
   — and counting per round made the number fall back to 1 twice in one real run (65 of 65, then 1 of 19, then
   1 of 12), which reads as the analysis starting over. The fixture is built to take two rounds so this can be
   asserted at all: three libraries reachable directly, a fourth only through the third. */
const events = [];
await assembleFactsOpeningAsync(app, ['*'], (p) => events.push(p));
ok(events.length >= 4, `progress is reported for each library (${events.length} events)`);
ok(events.every((e) => e.done <= e.total), `no event claims more done than there is to do (${events.map((e) => `${e.done}/${e.total}`).join(' ')})`);
const backwards = events.filter((e, i) => i > 0 && e.done < events[i - 1].done);
ok(backwards.length === 0, backwards.length ? `the count fell backwards ${backwards.length}x` : 'the count never falls backwards');
const shrank = events.filter((e, i) => i > 0 && e.total < events[i - 1].total);
ok(shrank.length === 0, shrank.length ? `the total shrank ${shrank.length}x` : 'the total never shrinks');
ok(new Set(events.map((e) => e.total)).size > 1, 'the fixture really does take more than one round');

rmSync(bundle, { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
