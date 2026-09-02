/**
 * Node smoke for `@weave-framework/migrate` detection — what kind of workspace is this, and what is inside it.
 *
 * Every case here is one the PREVIOUS detection got wrong, measured before this module was written:
 *   pnpm-ws  — `looksLikeMonorepo` returned false for a pnpm workspace (it knew nx.json / apps/ / workspaces only)
 *   npm-ws   — an Nx project declared through the root `workspaces` field, with no `project.json`, was returned
 *              as NONE: nothing was found at all, because the walk required angular.json or project.json
 *   untyped  — a project was found, but as a bare path: no name, no type, nowhere to put `projectType`
 *
 * The nx-mono case is a REGRESSION guard borrowed from the old fixture tree: whatever changes, the units that
 * detection already found must keep being found.
 *
 * Run: `node packages/migrate/test/detect.smoke.mjs` (wired as `pnpm verify:detect`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const fx = join(here, 'fixtures');
const nxMono = join(repo, 'packages', 'cli', 'test', 'fixtures', 'migrate', 'nx-mono');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:detect — workspace detection for the migration UI\n');

// Bundle to a path inside the repo so `node_modules` resolves for anything left external.
const out = join(repo, 'node_modules', '.weave-detect-smoke.mjs');
await esbuild({
  entryPoints: [join(here, '..', 'src', 'detect.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: out,
});
const d = await import(pathToFileURL(out).href);

const names = (w) => w.units.map((u) => u.name).sort();
const signal = (w, file) => w.signals.find((s) => s.file === file)?.found;

/* ── pnpm workspace: the marker the old detection had never heard of ── */
const pnpmWs = d.inspect(join(fx, 'pnpm-ws'));
ok(signal(pnpmWs, 'pnpm-workspace.yaml') === true, 'pnpm-ws: pnpm-workspace.yaml is reported as found');
ok(signal(pnpmWs, 'nx.json') === false, 'pnpm-ws: nx.json is reported as ABSENT (an absence is information)');
ok(names(pnpmWs).includes('shop'), 'pnpm-ws: the Angular app inside is found');

/* ── an Nx project declared only by package.json — previously invisible ── */
const npmWs = d.inspect(join(fx, 'npm-ws'));
ok(npmWs.units.length === 1, `npm-ws: the package.json-declared project is found (got ${npmWs.units.length})`);
ok(names(npmWs)[0] === '@acme/data', `npm-ws: it carries the name from package.json (got ${names(npmWs)[0]})`);
ok(npmWs.units[0]?.type === null, 'npm-ws: package.json states no type, so type is null — not guessed');
ok(npmWs.units[0]?.declaredBy === 'package.json', 'npm-ws: the UI can say where the name came from');

/* ── a project.json with no projectType: found, and honest about the gap ── */
const untyped = d.inspect(join(fx, 'untyped'));
ok(names(untyped)[0] === 'thing', 'untyped: the Nx Angular project is found by name');
ok(untyped.units[0]?.type === null, 'untyped: a missing projectType reads as null, never as "application"');
ok(untyped.units[0]?.declaredBy === 'project.json', 'untyped: declared by project.json');

/* ── one folder, several projects — found on a REAL repository, not imagined here.
   In tk-integration-ui-common-main, five component folders each declare 2-4 libraries in their own
   angular.json, with roots like projects/complete. Collapsing such a folder into one unit lost 13 real
   projects behind 5 entries, every name and type with them. The package.json beside it must NOT win. */
const multi = d.inspect(join(fx, 'multi'));
ok(multi.units.length === 3, `multi: one folder declaring 3 projects yields 3 units (got ${multi.units.length})`);
ok(names(multi).join(',') === 'complete,filename,harness', `multi: each carries its own name (got ${names(multi).join(',')})`);
const byMulti = Object.fromEntries(multi.units.map((u) => [u.name, u]));
ok(byMulti.harness?.type === 'application', 'multi: the one marked application keeps that type — it is the one you may not want');
ok(byMulti.complete?.type === 'library', 'multi: the libraries keep theirs');
ok(!names(multi).includes('@tie/component.dialog'), 'multi: the sibling package.json does not stand in for the projects');
ok(
  new Set(multi.units.map((u) => u.root)).size === 3,
  'multi: the three units are three different folders, not three names for one',
);

/* ── a path pointing straight AT an app, which is the most ordinary thing to do ──
   Reported from the screen: C:\_WORK\...\tsb-angular-v9, whose own angular.json declares one project with
   root "", answered "No Angular projects here". The walk never considers its own root — right for searching a
   monorepo, wrong for a path somebody typed on purpose. Every fixture missed it because every fixture pointed
   at a workspace root. */
const direct = d.inspect(join(fx, 'pnpm-ws', 'projects', 'shop'));
ok(direct.units.length === 1, `a path naming the app itself finds it (got ${direct.units.length})`);
ok(names(direct)[0] === 'shop', `and by its declared name (got ${names(direct)[0]})`);
ok(direct.units[0]?.declaredBy === 'angular.json', 'read from its own angular.json');

// The rule it must not break: a root that only LOOKS like a unit still loses to what is inside it.
const stillInside = d.inspect(join(fx, 'npm-ws'));
ok(
  stillInside.units.length === 1 && names(stillInside)[0] === '@acme/data',
  `a monorepo root still yields what is inside, not itself (got ${names(stillInside).join(',')})`,
);

/* ── regression: everything the old walk found must still be found, now with names and types ── */
const mono = d.inspect(nxMono);
ok(names(mono).join(',') === 'admin,shop,ui', `nx-mono: still finds admin, shop and ui (got ${names(mono).join(',')})`);
const byName = Object.fromEntries(mono.units.map((u) => [u.name, u]));
ok(byName.shop?.type === 'application', 'nx-mono: shop carries projectType application');
ok(byName.ui?.type === 'library', 'nx-mono: ui carries projectType library');
ok(!names(mono).includes('secondary'), 'nx-mono: the non-Angular @nx/js library is still left out');

/* ── the root is never a unit, however Angular-looking its own package.json is ──
   npm-ws's root declares @angular/core, the way a real monorepo root does. Asked about directly it answers
   "yes, a unit"; the walk must still never offer it, or the whole repository becomes a migration target. */
ok(d.unitsAt(join(fx, 'npm-ws')).length === 1, 'a monorepo root LOOKS like a unit when asked directly');
ok(
  !d.findUnits(join(fx, 'npm-ws')).some((u) => u.root === join(fx, 'npm-ws')),
  'the walk never offers the root itself as a migration target',
);

rmSync(out, { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
