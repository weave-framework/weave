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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const { readState, writeState, emptyState, STATE_FILE } = await import(pathToFileURL(bundle).href);

const dir = mkdtempSync(join(tmpdir(), 'weave-migrate-state-'));
const file = join(dir, STATE_FILE);

// ── nothing yet
const fresh = readState(dir);
ok(fresh.version === 1 && Object.keys(fresh.decisions).length === 0,
   'a project with no file yields an empty state, not an error');

// ── a round trip
const state = emptyState('apps/archiving');
state.decisions['component:AppComponent'] = 'migrate';
state.decisions['route:src/app/app.routes.ts#0'] = 'migrate';
state.done['service:ApiService'] = { at: '2026-09-04T10:00:00.000Z', to: '../weave-app' };
writeState(dir, state);
const back = readState(dir);
ok(back.decisions['component:AppComponent'] === 'migrate', 'a decision comes back as it went in');
ok(back.decisions['route:src/app/app.routes.ts#0'] === 'migrate', 'and so does a second one, under a path key');
ok(back.done['service:ApiService']?.to === '../weave-app', 'what was already carried across comes back too');
ok(back.unit === 'apps/archiving', 'the unit it describes is recorded');

/* It is committed, so the diff has to be readable: keys in order, and a trailing newline. Written in a random
   object order, the same set of marks produces a fresh diff every time anything is touched, which teaches a
   reviewer to stop reading it. */
const shuffled = emptyState('apps/archiving');
for (const k of ['service:Zed', 'component:Alpha', 'service:Mid']) shuffled.decisions[k] = 'migrate';
writeState(dir, shuffled);
const text = readFileSync(file, 'utf8');
const order = [...text.matchAll(/"(service:Zed|component:Alpha|service:Mid)"/g)].map((m) => m[1]);
ok(String(order) === String([...order].sort()), `keys are written in order (${order.join(', ')})`);
ok(text.endsWith('\n'), 'the file ends with a newline, like every other file in the repository');

/* Someone else's repository, so it has to survive what people do to files. */
writeFileSync(file, '{ not json at all', 'utf8');
ok(readState(dir).version === 1, 'a corrupt file yields an empty state rather than throwing');
writeFileSync(file, '[]', 'utf8');
ok(Object.keys(readState(dir).decisions).length === 0, 'a file holding the wrong shape yields an empty state');
writeFileSync(file, JSON.stringify({ version: 1, decisions: { a: 'demolish', b: 'migrate' }, done: { c: { at: 1 } } }), 'utf8');
const filtered = readState(dir);
ok(filtered.decisions.a === undefined && filtered.decisions.b === 'migrate',
   'a decision this version does not understand is dropped, the rest kept');
ok(Object.keys(filtered.done).length === 0, 'a half-written history entry is dropped rather than half-read');

// ── a newer writer adding fields must not cost this one its data
writeFileSync(file, JSON.stringify({
  version: 1, unit: 'x', decisions: { 'component:Keep': 'migrate' }, done: {}, futureField: { anything: true },
}), 'utf8');
ok(readState(dir).decisions['component:Keep'] === 'migrate',
   'a field this version has never heard of does not stop it reading the rest');

/* One decision, not two. `skip` marked a state nothing ever acted on — not marked already means not
   migrated — and having both on screen read as a puzzle: "kodel turime du migtukus". A file naming it was
   written by something else, and its marks are not this tool's to act on. */
writeFileSync(file, JSON.stringify({ version: 1, decisions: { a: 'skip', b: 'migrate' }, done: {} }), 'utf8');
const single = readState(dir);
ok(single.decisions.a === undefined, 'a decision word this version does not have is dropped');
ok(single.decisions.b === 'migrate', 'and the one it does have survives beside it');

rmSync(dir, { recursive: true, force: true });
rmSync(bundle, { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
