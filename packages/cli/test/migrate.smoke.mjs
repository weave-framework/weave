/**
 * Node smoke for `weave migrate` M1 — the source-app path resolution (RFC 0011).
 *
 * Bundles the CLI's migrate module (esbuild, platform=node), then drives the pure detection functions against
 * the fixture trees under test/fixtures/migrate: a plain Angular app, an Nx monorepo whose apps sit deeper, and
 * a non-Angular folder. No prompts here — the interactive shell is a thin wrapper over these functions.
 *
 * Run: `node packages/cli/test/migrate.smoke.mjs` (wired as `pnpm verify:migrate`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const fx = join(here, 'fixtures', 'migrate');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate — `weave migrate` M1 (source-app path resolution)\n');

// Bundle the migrate module to a temp file, then import it.
const out = join(repo, 'node_modules', '.weave-migrate-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: out,
});
const m = await import(pathToFileURL(out).href);

// Bundle the analyzer module too (M2).
const outA = join(repo, 'node_modules', '.weave-migrate-analyze-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-analyze.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outA,
});
const a = await import(pathToFileURL(outA).href);

// detectAngularAt — direct signals
ok(m.detectAngularAt(join(fx, 'plain-angular')), 'detectAngularAt: a plain Angular app (angular.json + @angular/core) is detected');
ok(!m.detectAngularAt(join(fx, 'not-angular')), 'detectAngularAt: a React folder is NOT detected');
ok(!m.detectAngularAt(join(fx, 'nx-mono')), 'detectAngularAt: an Nx root has no direct app (its apps are deeper)');

// looksLikeMonorepo
ok(m.looksLikeMonorepo(join(fx, 'nx-mono')), 'looksLikeMonorepo: an Nx root (nx.json + apps/) is a monorepo');
ok(!m.looksLikeMonorepo(join(fx, 'plain-angular')), 'looksLikeMonorepo: a plain app is not a monorepo');

// isNxAngularProject — any Angular UNIT (application OR library — both migratable)
ok(m.isNxAngularProject(join(fx, 'nx-mono', 'apps', 'shop')), 'isNxAngularProject: an Angular application is a unit');
ok(m.isNxAngularProject(join(fx, 'nx-mono', 'libs', 'ui')), 'isNxAngularProject: an Angular LIBRARY is a unit too (not filtered out)');

// findAngularApps — deep search finds every unit (apps AND libs); a service/component migrates from inside one
const units = m.findAngularApps(join(fx, 'nx-mono')).sort();
ok(units.length === 3, `findAngularApps: found all three units — 2 apps + 1 lib (got ${units.length})`);
ok(units.some((a) => a.endsWith('shop')) && units.some((a) => a.endsWith('admin')), 'findAngularApps: includes apps/shop and apps/admin');
ok(units.some((a) => a.includes('libs')), 'findAngularApps: includes the library too (libs are migratable)');

// resolveAngularApp — the whole resolution
ok(m.resolveAngularApp(join(fx, 'plain-angular')).app?.endsWith('plain-angular'), 'resolve: a plain app path resolves to itself');
const nxRes = m.resolveAngularApp(join(fx, 'nx-mono'));
ok(!nxRes.app && nxRes.candidates?.length === 3, 'resolve: an Nx root offers all its units as candidates (not the root)');
ok(m.resolveAngularApp(join(fx, 'not-angular')).none === true, 'resolve: a non-Angular folder resolves to none');
ok(m.resolveAngularApp(join(fx, 'does-not-exist')).none === true, 'resolve: a missing path resolves to none');

// a directly-typed path to ONE Nx project (project.json, no angular.json) resolves to itself — pointing straight
// at a single service/library inside a big workspace
ok(m.resolveAngularApp(join(fx, 'nx-mono', 'apps', 'shop')).app?.endsWith('shop'), 'resolve: a direct path to an Nx app (project.json) resolves to itself');
ok(m.resolveAngularApp(join(fx, 'nx-mono', 'libs', 'ui')).app?.endsWith('ui'), 'resolve: a direct path to an Nx library (project.json) resolves to itself');

// a multi-project Angular CLI workspace (angular.json lists apps + libs) → offer them ALL, not the root
const wsProjects = m.readAngularProjects(join(fx, 'ng-workspace'));
ok(wsProjects.length === 3, `readAngularProjects: all three projects (2 apps + 1 lib) (got ${wsProjects.length})`);
const wsRes = m.resolveAngularApp(join(fx, 'ng-workspace'));
ok(!wsRes.app && wsRes.candidates?.length === 3, 'resolve: a multi-project angular.json offers all its units (NOT the workspace root)');
ok(wsRes.candidates?.every((c) => c.includes('projects')), 'resolve: the candidates are the project roots (projects/*)');

// a monorepo with exactly ONE Angular app auto-resolves (no pick needed)
const single = mkdtempSync(join(tmpdir(), 'weave-migrate-'));
try {
  const appsDir = join(single, 'apps', 'only');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(appsDir, { recursive: true });
  writeFileSync(join(single, 'nx.json'), '{}');
  writeFileSync(join(appsDir, 'project.json'), '{"targets":{"build":{"executor":"@angular-devkit/build-angular:browser"}}}');
  const r = m.resolveAngularApp(single);
  ok(r.app?.endsWith('only'), 'resolve: an Nx root with a SINGLE Angular app auto-resolves it (no pick)');
} finally {
  rmSync(single, { recursive: true, force: true });
}

// a big workspace (> 10 units) resolves to MANY candidates → the command asks for an exact path, not a menu
const big = mkdtempSync(join(tmpdir(), 'weave-migrate-big-'));
try {
  const { mkdirSync } = await import('node:fs');
  writeFileSync(join(big, 'nx.json'), '{}');
  for (let i = 0; i < 12; i++) {
    const d = join(big, 'libs', `lib${i}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'project.json'), '{"projectType":"library","targets":{"build":{"executor":"@nx/angular:package"}}}');
  }
  const r = m.resolveAngularApp(big);
  ok((r.candidates?.length ?? 0) > 10, `resolve: a >10-unit workspace returns many candidates (got ${r.candidates?.length}) → the command asks for an exact path`);
} finally {
  rmSync(big, { recursive: true, force: true });
}

// ── M2.1: find the selected unit's ENTRY point (where the dependency walk begins) ──
// an app: the build target's `main` (project.json declares "apps/shop/src/main.ts", workspace-relative)
ok(a.findEntryPoint(join(fx, 'nx-mono', 'apps', 'shop'))?.endsWith('main.ts'), 'findEntryPoint: an app resolves its build `main` (src/main.ts)');
// a library: its public entry (src/index.ts)
ok(a.findEntryPoint(join(fx, 'nx-mono', 'libs', 'ui'))?.endsWith('index.ts'), 'findEntryPoint: a library resolves its public entry (src/index.ts)');
// a plain Angular app: src/main.ts by convention
ok(a.findEntryPoint(join(fx, 'plain-angular'))?.endsWith('main.ts'), 'findEntryPoint: a plain app resolves src/main.ts');
// nothing to find → null (recorded as "no entry — human, look", never guessed)
ok(a.findEntryPoint(join(fx, 'not-angular')) === null, 'findEntryPoint: no entry found → null');

// ── M2.2: parse the entry's imports (the first tree level), classified ──
const entry = a.findEntryPoint(join(fx, 'nx-mono', 'apps', 'shop'));
const imports = a.parseImports(entry);
const byKind = (k) => imports.filter((i) => i.kind === k);
ok(byKind('angular').some((i) => i.spec === '@angular/platform-browser'), 'parseImports: @angular/* → angular (source framework)');
ok(byKind('third-party').some((i) => i.spec === 'lodash-es'), 'parseImports: a real package → third-party');
const rel = byKind('relative');
ok(rel.some((i) => i.spec === './app/app.component' && i.resolved?.endsWith('app.component.ts')), 'parseImports: a relative import resolves to its file');
ok(rel.some((i) => i.spec === './app/lazy.routes'), 'parseImports: a dynamic import() (lazy route) is captured too');
ok(imports.length === 4, `parseImports: found all four imports (got ${imports.length})`);

// ── M2.3: the downward walk — follow relative imports to the leaves ──
const walk = a.walkDependencies(entry);
ok(walk.files.some((f) => f.endsWith('main.ts')) && walk.files.some((f) => f.endsWith('app.component.ts')) && walk.files.some((f) => f.endsWith('lazy.routes.ts')),
  'walkDependencies: reaches main → app.component + lazy.routes (down the tree)');
ok(walk.angular.includes('@angular/platform-browser') && walk.angular.includes('@angular/core'), 'walkDependencies: collects @angular/* from anywhere in the tree');
ok(walk.thirdParty.includes('lodash-es'), 'walkDependencies: collects third-party packages at the edges');
ok(walk.cycles.length === 0, 'walkDependencies: no cycle in a clean tree');

// a cycle a → b → a is REPORTED, not followed forever
const cyc = mkdtempSync(join(tmpdir(), 'weave-migrate-cyc-'));
try {
  writeFileSync(join(cyc, 'a.ts'), "import './b';");
  writeFileSync(join(cyc, 'b.ts'), "import './a';");
  const w = a.walkDependencies(join(cyc, 'a.ts'));
  ok(w.cycles.length === 1, `walkDependencies: a↔b cycle is reported once (got ${w.cycles.length})`);
  ok(w.files.length === 2, 'walkDependencies: both files still walked (the cycle did not loop forever)');
} finally {
  rmSync(cyc, { recursive: true, force: true });
}

// an unresolved relative import is recorded (human, look), never guessed
const miss = mkdtempSync(join(tmpdir(), 'weave-migrate-miss-'));
try {
  writeFileSync(join(miss, 'x.ts'), "import './does-not-exist';");
  const w = a.walkDependencies(join(miss, 'x.ts'));
  ok(w.unresolved.includes('./does-not-exist'), 'walkDependencies: an unresolvable relative import is recorded');
} finally {
  rmSync(miss, { recursive: true, force: true });
}

rmSync(out, { force: true });
rmSync(outA, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ weave migrate M1 + M2.1 — path resolution + entry-point discovery.');
