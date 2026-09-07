/**
 * Node smoke for step three — what a selection actually costs, before anything is written.
 *
 * Step three exists because a panel listed all 27 of one application's outside classes under the canvas, at
 * the moment nothing had been chosen, and the reader asked what it was for. The honest answer was that the
 * number existed. Narrowed to a selection the same data is a to-do list: measured on that application with the
 * options the service itself passes, the spread across its 28 routes is min 0, median 12, max 19 of the 27, and
 * 18 of the 28 reach fewer than half. (A first pass reported a median of 3 by calling `assembleFacts` where the
 * service calls `assembleFactsOpening(target, ['*'])` — a smaller graph, so a different program measured.)
 *
 * That narrowing is the whole claim, so it is the first thing asserted here — a version reporting every
 * external regardless of the marks passes every other check in this file and is exactly the bug removed.
 *
 * The second claim is riskier, because it is a fact copied out of another package: the converter rewrites
 * TWO of those 27 by itself. `CONVERTED` names them, `SERVICE_METHODS` in `packages/cli/src/migrate-convert.ts`
 * is where it is true, and nothing links the two but the assertion at the bottom of this file. Without it,
 * the day the converter learns a third service the UI quietly starts telling people to do work already done.
 *
 * Run: `node packages/migrate/test/consequence.smoke.mjs` (wired as `pnpm verify:migrate-consequence`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const app = join(here, 'fixtures', 'alias-modules', 'app');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-consequence — a selection reports its own cost, not the application’s\n');

const bundles = {};
for (const [name, entry] of [
  ['analyze', join(repo, 'packages', 'migrate', 'src', 'analyze.ts')],
  ['graph', join(repo, 'packages', 'migrate', 'src', 'graph.ts')],
  ['handled', join(repo, 'packages', 'migrate', 'src', 'handled.ts')],
  ['consequence', join(repo, 'packages', 'migrate', 'ui', 'src', 'app', 'consequence.ts')],
]) {
  const out = join(here, `.consequence.${name}.mjs`);
  await esbuild({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external' });
  bundles[name] = await import(pathToFileURL(out).href);
}
const { consequence, undecided } = bundles.consequence;
const { handledFor, CONVERTED, TEMPLATE_ONLY } = bundles.handled;

/* ── the narrowing, on a graph shaped to make failure visible ──
   Two screens that share nothing. Marking one must report ITS outsider and not the other's — the fixture the
   analysis produces has a single external, so it cannot tell a narrowed list from a complete one. */
const node = (id, kind, extra = {}) => ({ id, key: id, kind, label: id.split(':')[1], detail: '', weight: 0, ...extra });
const two = {
  root: '/app',
  nodes: [
    node('component:Login', 'component', { file: 'src/login.ts' }),
    node('service:Auth', 'service', { file: 'src/auth.ts' }),
    node('external:TranslateService', 'external', { library: '@ngx-translate/core' }),
    node('component:Billing', 'component', { file: 'src/billing.ts' }),
    node('external:ToastrService', 'external'),
    node('external:Router', 'external', { library: '@angular/router' }),
  ],
  edges: [
    { from: 'component:Login', to: 'service:Auth', kind: 'injects' },
    { from: 'service:Auth', to: 'external:TranslateService', kind: 'injects' },
    { from: 'component:Login', to: 'external:Router', kind: 'injects' },
    { from: 'component:Billing', to: 'external:ToastrService', kind: 'injects' },
  ],
};

const all = two.nodes.filter((n) => n.kind === 'external').length;
const one = consequence(two, { 'component:Login': 'migrate' });
const names = one.outside.map((o) => o.node.label).sort();
ok(all === 3, `the graph holds ${all} outside classes in total`);
ok(one.outside.length === 2, `marking one screen reports ${one.outside.length} of them, not all ${all}`);
ok(!names.includes('ToastrService'), `and not the one only the other screen injects (${names.join(', ')})`);

/* What comes along uninvited — the thing a reader cannot see from the marks alone. */
ok(one.chosen.length === 1 && one.chosen[0].label === 'Login', 'what was marked is reported as chosen');
ok(one.carried.length === 1 && one.carried[0].label === 'Auth',
   `and what it drags in is reported apart from it (${one.carried.map((n) => n.label).join(', ') || 'none'})`);
ok(!one.carried.some((n) => n.kind === 'external'), 'an outside class is never counted among what we carry');
ok(String(one.files) === String(['src/auth.ts', 'src/login.ts']), `the files behind both are listed (${one.files.join(', ')})`);

/* Two marks sharing a dependency must report it once, and never as "carried" when it was itself marked. */
const both = consequence(two, { 'component:Login': 'migrate', 'service:Auth': 'migrate' });
ok(both.carried.length === 0, `a marked dependency is not also reported as carried (${both.carried.length})`);
ok(both.chosen.length === 2, 'both marks are reported as chosen');
ok(consequence(two, {}).outside.length === 0, 'nothing marked reports nothing at all — not the whole application');
ok(consequence(null, { 'component:Login': 'migrate' }).chosen.length === 0, 'no graph yields the empty answer rather than throwing');

/* ── the verdicts ──
   Three of these four are the tool admitting it cannot help, which is the point of showing them. */
ok(handledFor('Router', '@angular/router') === 'automatic', 'Router is rewritten by the converter');
ok(handledFor('HttpClient', '@angular/common/http') === 'automatic', 'so is HttpClient');
ok(handledFor('MatDialog', '@angular/material/dialog') === 'template-only',
   'MatDialog is mapped in markup only — injected, it is left alone');
ok(handledFor('TranslateService', '@ngx-translate/core') === 'none', 'a library with no mapping says so');
ok(handledFor('ToastrService', undefined) === 'unread', 'a class traced to no library is UNREAD, not "no mapping"');
ok(undecided(one.outside) === 1, `one of this selection's two still wants a person (${undecided(one.outside)})`);

/* ── the same code, on what the analysis really produces ── */
const facts = bundles.analyze.assembleFactsOpening(app, ['*']);
const real = bundles.graph.buildGraph(facts);
const shell = real.nodes.find((n) => n.label === 'ShellComponent');
const solo = real.nodes.find((n) => n.kind === 'route' && n.label === 'solo');
ok(!!shell && !!solo, 'the fixture yields the nodes this part needs');
const fromSolo = consequence(real, { [solo.key]: 'migrate' });
ok(fromSolo.outside.some((o) => o.node.label === 'Router'),
   'a real graph reports the external its marked route injects');
ok(fromSolo.outside.every((o) => o.handled === 'automatic'),
   'and Router alone needs nothing from the reader');
ok(consequence(real, { [shell.key]: 'migrate' }).outside.length === 0,
   'a screen that injects nothing outside reports nothing outside');

/* ── the fact copied from another package ──
   `CONVERTED` is a duplicate of the converter's own table. Duplicating a fact is a promise to keep it true,
   and this is the only thing that keeps it. Read as text: importing the converter would pull the whole CLI
   into a UI bundle that has no business containing it. */
const source = readFileSync(join(repo, 'packages', 'cli', 'src', 'migrate-convert.ts'), 'utf8');
const table = source.slice(source.indexOf('const SERVICE_METHODS'));
const body = table.slice(table.indexOf('{'), table.indexOf('\n};'));
const declared = [...body.matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]).sort();
ok(declared.length > 0, `the converter's own table was found and parsed (${declared.join(', ') || 'NOTHING — the parse broke'})`);
ok(String(declared) === String(Object.keys(CONVERTED).sort()),
   `and it names exactly what we claim is automatic (converter: ${declared.join(', ')} | ours: ${Object.keys(CONVERTED).sort().join(', ')})`);

/* Every Material class we call template-only must actually appear in the converter, or the note is invented. */
const missing = Object.keys(TEMPLATE_ONLY).filter((n) => !source.includes(n.replace(/^Mat/, 'mat').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()) && !source.includes(n));
ok(missing.length === 0, `every template-only class is one the converter knows (${missing.join(', ') || 'all of them'})`);

for (const name of ['analyze', 'graph', 'handled', 'consequence']) rmSync(join(here, `.consequence.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
