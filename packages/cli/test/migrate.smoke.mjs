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
ok(walk.thirdParty.includes('lodash-es') && walk.thirdParty.includes('rxjs'), 'walkDependencies: collects real third-party packages (lodash-es, rxjs)');
ok(walk.cycles.length === 0, 'walkDependencies: no cycle in a clean tree');

// ── internal libraries (tsconfig path alias) are NOTED as their own migration unit, not followed (following
//    a barrel's `export *` dragged in the whole lib — 214 files from one `import { IBreadcrumb }`) ──
ok(walk.internal.includes('@sps-interfaces'), 'walkDependencies: a workspace lib (@sps-interfaces via tsconfig paths) is INTERNAL');
ok(!walk.thirdParty.includes('@sps-interfaces'), 'walkDependencies: the internal lib is NOT listed as third-party');
ok(!walk.files.some((f) => f.includes('sps-interfaces')), 'walkDependencies: the internal lib is NOT expanded into the file set (noted as an edge — it migrates separately)');

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

// ── M2.8: classify third-party packages — auto (confident) / try (your call) / keep (no Weave role) ──
// a subpath collapses to its installable package root (one decision for rxjs + rxjs/operators)
ok(a.rootPackage('rxjs/operators') === 'rxjs', 'rootPackage: a subpath collapses to the package root');
ok(a.rootPackage('@ngx-translate/core') === '@ngx-translate/core', 'rootPackage: a scoped package keeps @scope/name');
// the confident list → auto, with what it becomes
ok(a.classifyPackage('rxjs').decision === 'auto', 'classifyPackage: rxjs → auto (Weave reactivity)');
ok(a.classifyPackage('rxjs/operators').decision === 'auto', 'classifyPackage: rxjs/operators collapses to rxjs → auto');
ok(a.classifyPackage('@ngx-translate/core').decision === 'auto' && a.classifyPackage('@ngx-translate/core').note.includes('i18n'), 'classifyPackage: @ngx-translate → auto (@weave-framework/i18n)');
// famous pure libraries → keep, by NAME even with no keywords (no node_modules needed)
ok(a.classifyPackage('d3').decision === 'keep', 'classifyPackage: d3 → keep (no Weave equivalent)');
ok(a.classifyPackage('d3-scale').decision === 'keep', 'classifyPackage: d3-scale (d3-* family) → keep');
ok(a.classifyPackage('lodash').decision === 'keep', 'classifyPackage: lodash → keep');
// unknown package, no keywords → try (honest: the user decides)
ok(a.classifyPackage('some-obscure-pkg').decision === 'try', 'classifyPackage: an unknown package → try (your call)');
// keywords sharpen the guess: a charting keyword → keep; a framework-role keyword pulls it back to try
ok(a.classifyPackage('mystery-viz', ['visualization', 'chart']).decision === 'keep', 'classifyPackage: charting keywords → keep');
ok(a.classifyPackage('mystery-http', ['http', 'rest']).decision === 'try', 'classifyPackage: a framework-role keyword (http) → try, not keep');
ok(a.classifyPackage('mystery-both', ['chart', 'state']).decision === 'try', 'classifyPackage: a framework keyword overrides a keep keyword → try');
// classifyPackages: collapses + dedupes rxjs + rxjs/operators into ONE decision, sorted
const plans = a.classifyPackages(['rxjs/operators', 'rxjs', 'lodash', 'some-obscure-pkg']);
ok(plans.length === 3, `classifyPackages: rxjs + rxjs/operators dedupe to one (got ${plans.length} plans)`);
ok(plans.filter((p) => p.decision === 'auto').length === 1 && plans.some((p) => p.decision === 'keep') && plans.some((p) => p.decision === 'try'), 'classifyPackages: the three buckets each appear');

// ── M2.4: components — what an @Component declares (selector, inputs/outputs, template, styles) ──
const comps = join(fx, 'components');
const decs = a.findComponents(join(comps, 'decorator.component.ts'));
ok(decs.length === 1, `findComponents: one @Component in the decorator fixture (got ${decs.length})`);
const dc = decs[0];
ok(dc.className === 'DecoratorComponent' && dc.selector === 'app-decorator', 'findComponents: reads className + selector');
ok(dc.standalone === false, 'findComponents: standalone:false is read (not guessed)');
ok(dc.inputs.includes('title') && dc.inputs.includes('count') && dc.inputs.length === 2, 'findComponents: @Input properties are collected');
ok(dc.outputs.length === 1 && dc.outputs[0] === 'saved', 'findComponents: @Output properties are collected');
ok(dc.templateInline === true && dc.templateUrl === null, 'findComponents: an inline template is flagged, no templateUrl');
ok(dc.inlineStyles === 2 && dc.styleUrls.length === 0, 'findComponents: inline styles are counted (2)');

const sigs = a.findComponents(join(comps, 'signal.component.ts'));
const sc = sigs[0];
ok(sc.standalone === true, 'findComponents: standalone:true is read');
ok(sc.inputs.includes('name') && sc.inputs.includes('id') && sc.inputs.includes('size'), 'findComponents: signal inputs input()/input.required()/model() are collected');
ok(sc.outputs.includes('changed'), 'findComponents: signal output() is collected');
ok(sc.templateInline === false && sc.templateUrl === './signal.component.html', 'findComponents: an external templateUrl is captured');
ok(sc.styleUrls.length === 2 && sc.inlineStyles === 0, 'findComponents: styleUrls are captured (2)');

ok(a.findComponents(join(comps, 'service.ts')).length === 0, 'findComponents: a file with no @Component yields nothing (an @Injectable is not a component)');
ok(a.findComponents(join(comps, 'does-not-exist.ts')).length === 0, 'findComponents: an unreadable file yields nothing (no throw)');

// analyzeComponents flattens across a file set
const all = a.analyzeComponents([join(comps, 'decorator.component.ts'), join(comps, 'signal.component.ts'), join(comps, 'service.ts')]);
ok(all.length === 2, `analyzeComponents: two components across three files (got ${all.length})`);

// ── the shared UI colour palette: wraps under FORCE_COLOR, no-ops under NO_COLOR (the clean-piped guarantee) ──
// COLOR is decided at module-eval from env, so we bundle migrate-ui once and import it twice under different env
// (a distinct ?query gives Node a fresh module instance, hence a fresh COLOR decision).
const outUi = join(repo, 'node_modules', '.weave-migrate-ui-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-ui.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outUi,
});
delete process.env.NO_COLOR;
process.env.FORCE_COLOR = '1';
const uiOn = await import(pathToFileURL(outUi).href + '?on');
ok(uiOn.c.red('x').startsWith('\x1b[31m') && uiOn.c.red('x').endsWith('\x1b[39m'), 'colours: FORCE_COLOR wraps text in ANSI codes');
ok(uiOn.c.green('hi').includes('hi'), 'colours: the wrapped text still contains the original');
process.env.NO_COLOR = '1'; // NO_COLOR wins even with FORCE_COLOR set
const uiOff = await import(pathToFileURL(outUi).href + '?off');
ok(uiOff.c.red('x') === 'x', 'colours: NO_COLOR yields plain text — the clean piped-output guarantee');
delete process.env.NO_COLOR;
delete process.env.FORCE_COLOR;

rmSync(out, { force: true });
rmSync(outA, { force: true });
rmSync(outUi, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ weave migrate M1 + M2.1 — path resolution + entry-point discovery.');
