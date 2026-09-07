/**
 * Node smoke for `@weave-framework/migrate` state — the decisions a migration remembers between sittings.
 *
 * A large application is not migrated in one go, and until now every decision made on the canvas died with the
 * browser tab. The file lives in the SOURCE project so it travels with the repository: a colleague on the same
 * branch sees the same marks, and the history shows the migration advancing.
 *
 * That places it in someone else's repository, which sets the bar for everything here. It must survive being
 * hand-edited, half-written, or written by a newer version; it must never throw an application away because a
 * file has a stray comma; and it must produce a diff a person can read.
 *
 * Run: `node packages/migrate/test/state.smoke.mjs` (wired as `pnpm verify:migrate-state`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-state — decisions survive the tab closing\n');

const bundle = join(here, '.state.bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'migrate', 'src', 'state.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, packages: 'external',
});
const { readState, writePlan, emptyPlan, sourceKey, STATE_FILE } = await import(pathToFileURL(bundle).href);

const into = mkdtempSync(join(tmpdir(), 'weave-into-'));
const file = join(into, STATE_FILE);
const source = join(tmpdir(), 'some-angular-app', 'apps', 'archiving');
/* The source directory exists, so a version of this that wrote there would SUCCEED — and the assertion
   below would then be the only thing standing between the tool and a file in somebody else's repository. */
mkdirSync(source, { recursive: true });

/* The plan belongs to the project being migrated INTO. The source is read and never written to: it is a
   working repository, quite possibly somebody else's, and the first version of this left a file in it. */
ok(readState(into).version === 2, 'a project with no file yields an empty state, not an error');
ok(Object.keys(readState(into).sources).length === 0, 'and no plans');

const plan = emptyPlan(source);
plan.decisions['component:AppComponent'] = 'migrate';
plan.decisions['route:src/app/app.routes.ts#0'] = 'migrate';
plan.done['service:ApiService'] = { at: '2026-09-04T10:00:00.000Z', to: 'src/app' };
const written = writePlan(into, source, plan);
ok(written === file, `written into the target project (${written})`);
ok(!existsSync(join(source, STATE_FILE)), 'and nothing at all is written beside the source');

const back = readState(into).sources[sourceKey(source)];
ok(back?.decisions['component:AppComponent'] === 'migrate', 'a decision comes back as it went in');
ok(back?.decisions['route:src/app/app.routes.ts#0'] === 'migrate', 'and so does a second, under a path key');
ok(back?.done['service:ApiService']?.to === 'src/app', 'what was already carried across comes back too');
ok(back?.source === source, 'the plan records which source it is about');
ok(sourceKey(source) === 'archiving', `filed under the folder name, not the path (${sourceKey(source)})`);

/* One Weave project can take pieces from more than one Angular application. */
const other = join(tmpdir(), 'another-app', 'apps', 'billing');
const second = emptyPlan(other);
second.decisions['component:Invoice'] = 'migrate';
writePlan(into, other, second);
const both = readState(into).sources;
ok(Object.keys(both).length === 2, `two sources live side by side (${Object.keys(both).join(', ')})`);
ok(both.archiving?.decisions['component:AppComponent'] === 'migrate',
   'and writing the second left the first exactly as it was');

/* Committed, so the diff has to be readable: keys in order, and a trailing newline. */
const shuffled = emptyPlan(source);
for (const k of ['service:Zed', 'component:Alpha', 'service:Mid']) shuffled.decisions[k] = 'migrate';
writePlan(into, source, shuffled);
const text = readFileSync(file, 'utf8');
const order = [...text.matchAll(/"(service:Zed|component:Alpha|service:Mid)"/g)].map((m) => m[1]);
ok(String(order) === String([...order].sort()), `keys are written in order (${order.join(', ')})`);
ok(text.endsWith('\n'), 'the file ends with a newline, like every other file in the repository');
/* Somebody's repository, so it has to survive what people do to files. */
writeFileSync(file, '{ not json at all', 'utf8');
ok(readState(into).version === 2, 'a corrupt file yields an empty state rather than throwing');
writeFileSync(file, '[]', 'utf8');
ok(Object.keys(readState(into).sources).length === 0, 'a file holding the wrong shape yields an empty state');
writeFileSync(file, JSON.stringify({
  version: 2, sources: { archiving: { source: 'x', decisions: { a: 'skip', b: 'migrate' }, done: { c: { at: 1 } } } },
}), 'utf8');
const filtered = readState(into).sources.archiving;
ok(filtered.decisions.a === undefined && filtered.decisions.b === 'migrate',
   'a decision word this version does not have is dropped, the rest kept');
ok(Object.keys(filtered.done).length === 0, 'a half-written history entry is dropped rather than half-read');

writeFileSync(file, JSON.stringify({
  version: 2, sources: { archiving: { source: 'x', decisions: { 'component:Keep': 'migrate' }, done: {} } },
  futureField: { anything: true },
}), 'utf8');
ok(readState(into).sources.archiving.decisions['component:Keep'] === 'migrate',
   'a field this version has never heard of does not stop it reading the rest');

rmSync(into, { recursive: true, force: true });
rmSync(join(tmpdir(), 'some-angular-app'), { recursive: true, force: true });
rmSync(bundle, { force: true });
console.log(`
${failures ? `${failures} failing` : 'all green'}
`);
process.exit(failures ? 1 : 0);
