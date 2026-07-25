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
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// Bundle the plan writer too (M3).
const outP = join(repo, 'node_modules', '.weave-migrate-plan-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-plan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outP,
});
const pl = await import(pathToFileURL(outP).href);

// Bundle the converter too (M4).
const outC = join(repo, 'node_modules', '.weave-migrate-convert-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-convert.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outC,
});
const cv = await import(pathToFileURL(outC).href);

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

// ── M2.5: services + injection — @Injectable providedIn, public methods, DI edges ──
const svcs = join(fx, 'services');
const api = a.findServices(join(svcs, 'api.service.ts'));
ok(api.length === 1 && api[0].className === 'ApiService', 'findServices: the @Injectable class is found');
ok(api[0].providedIn === 'root', 'findServices: providedIn:"root" is read');
ok(api[0].methods.includes('get') && api[0].methods.includes('post'), 'findServices: public methods are collected');
ok(!api[0].methods.includes('buildHeaders'), 'findServices: a private method is NOT a public method');
ok(api[0].injects.includes('HttpClient'), 'findServices: a constructor-injected type is a DI edge');
ok(api[0].injects.includes('Logger'), 'findServices: an inject() call is a DI edge too');

const scoped = a.findServices(join(svcs, 'scoped.service.ts'));
ok(scoped[0].providedIn === null, 'findServices: no providedIn → null (not guessed)');
// a service whose API is a FIELD, not a method — counting only methods read as "0 public API" (found on real code)
ok(scoped[0].fields.includes('state') && scoped[0].fields.includes('label'), 'findServices: public FIELDS are part of the surface');
ok(!scoped[0].fields.includes('hidden'), 'findServices: a private field is not public surface');
// each detection path must stand ALONE: `items` has only an initializer, `declared` has only a type annotation
ok(scoped[0].signals.includes('items'), 'findServices: a signal field is detected by its signal() initializer alone');
ok(scoped[0].signals.includes('declared'), 'findServices: a signal field is detected by its Signal<T> type alone');
ok(!scoped[0].signals.includes('label'), 'findServices: a plain public field is not counted as a signal');
ok(a.findComponents(join(svcs, 'api.service.ts')).length === 0, 'findServices/findComponents: a service is not a component');
ok(a.findServices(join(comps, 'decorator.component.ts')).length === 0, 'findServices: a @Component is not a service');
ok(a.findServices(join(svcs, 'nope.ts')).length === 0, 'findServices: an unreadable file yields nothing');

// analyzeServices flattens; diGraph turns injects into who→what edges
const allSvc = a.analyzeServices([join(svcs, 'api.service.ts'), join(svcs, 'scoped.service.ts')]);
ok(allSvc.length === 2, `analyzeServices: two services (got ${allSvc.length})`);
const edges = a.diGraph(allSvc);
ok(edges.some((e) => e.from === 'ApiService' && e.to === 'HttpClient'), 'diGraph: ApiService → HttpClient is an edge');
ok(edges.some((e) => e.from === 'ApiService' && e.to === 'Logger'), 'diGraph: ApiService → Logger is an edge');

// ── M2.6: routes + guards — Routes config, RouterModule.forRoot, guards, children, lazy, redirects ──
const routesDir = join(fx, 'routes');
const routes = a.findRoutes(join(routesDir, 'app.routes.ts'));
ok(routes.length === 5, `findRoutes: 5 routes incl. the nested child (got ${routes.length})`);
ok(routes.some((r) => r.path === '' && r.component === 'HomeComponent'), 'findRoutes: a plain path+component route');
const admin = routes.find((r) => r.path === 'admin');
ok(admin && admin.guards.includes('AuthGuard'), 'findRoutes: canActivate/canDeactivate guards are captured');
ok(routes.some((r) => r.path === 'users' && r.component === 'HomeComponent'), 'findRoutes: a nested child route is flattened in');
ok(routes.some((r) => r.path === 'lazy' && r.lazy === true), 'findRoutes: a loadComponent route is marked lazy');
ok(routes.some((r) => r.path === '**' && r.redirectTo === ''), 'findRoutes: a wildcard redirect is captured');

const modRoutes = a.findRoutes(join(routesDir, 'module.routes.ts'));
ok(modRoutes.some((r) => r.path === 'dash' && r.component === 'DashComponent' && r.guards.includes('RoleGuard')), 'findRoutes: RouterModule.forRoot([...]) config is read');
ok(a.findRoutes(join(comps, 'decorator.component.ts')).length === 0, 'findRoutes: a component file has no routes');
ok(a.analyzeRoutes([join(routesDir, 'app.routes.ts'), join(routesDir, 'module.routes.ts')]).length === 6, 'analyzeRoutes: flattens across files (5 + 1)');

// ── M2.7: forms — reactive-forms primitives + control names, gated on an @angular/forms import ──
const formsDir = join(fx, 'forms');
const forms = a.findForms(join(formsDir, 'login.component.ts'));
ok(forms.length === 1 && forms[0].className === 'LoginComponent', 'findForms: a forms file is found, with its class');
ok(forms[0].primitives.includes('FormGroup') && forms[0].primitives.includes('FormBuilder'), 'findForms: imported @angular/forms primitives are listed');
ok(forms[0].controls.includes('email') && forms[0].controls.includes('password'), 'findForms: new FormGroup({...}) control names are read');
ok(forms[0].controls.includes('name') && forms[0].controls.includes('age'), 'findForms: fb.group({...}) control names are read');
ok(a.findForms(join(formsDir, 'grouped.ts')).length === 0, 'findForms: a .group() call without @angular/forms is NOT a form (import is the gate)');
ok(a.findForms(join(comps, 'decorator.component.ts')).length === 0, 'findForms: a plain component is not a form');
ok(a.analyzeForms([join(formsDir, 'login.component.ts'), join(formsDir, 'grouped.ts')]).length === 1, 'analyzeForms: only the real forms file counts');

// ── M2.9: call graph (best-effort) — self-calls, resolved-via-injected-field calls, dynamic (unknown) receivers ──
const callsDir = join(fx, 'calls');
const edges2 = a.findCalls(join(callsDir, 'widget.component.ts'));
ok(edges2.some((e) => e.from === 'WidgetComponent.load' && e.to === 'WidgetComponent.refresh' && !e.dynamic), 'findCalls: a this.method() self-call edge');
ok(edges2.some((e) => e.to === 'ApiService.get' && !e.dynamic), 'findCalls: a call through an inject() field resolves to the dep type');
ok(edges2.some((e) => e.to === 'HelperService.format' && !e.dynamic), 'findCalls: a call through a constructor field resolves to the dep type');
const dyn = edges2.find((e) => e.to === '?.doIt');
ok(dyn && dyn.dynamic === true, 'findCalls: a call through an unresolved field is flagged dynamic (?, never guessed)');
ok(a.findCalls(join(comps, 'service.ts')).length === 0, 'findCalls: a class with no tracked calls yields no edges');
ok(a.analyzeCalls([join(callsDir, 'widget.component.ts')]).length === edges2.length, 'analyzeCalls: flattens across files');

// ── M2.10: branch capture (best-effort) — the if/else/ternary/switch shape per method ──
const branchesDir = join(fx, 'branches');
const branches = a.findBranches(join(branchesDir, 'logic.ts'));
ok(branches.length === 1 && branches[0].method === 'Logic.decide', 'findBranches: only the branching method is recorded (noop omitted)');
const b0 = branches[0];
ok(b0.ifs === 2 && b0.elses === 1, `findBranches: if/else counted (ifs=${b0.ifs}, elses=${b0.elses})`);
ok(b0.ternaries === 1 && b0.switches === 1, `findBranches: ternary + switch counted (ternaries=${b0.ternaries}, switches=${b0.switches})`);
ok(a.analyzeBranches([join(branchesDir, 'logic.ts')]).length === 1, 'analyzeBranches: flattens across files');

// ── M2.8 (map half) + M2.11: package-usage map, the whole facts map, and writing facts.json ──
const shop = join(fx, 'nx-mono', 'apps', 'shop');
const facts = a.assembleFacts(shop);
ok(facts.entry?.endsWith('main.ts'), 'assembleFacts: entry resolves to the unit main');
ok(facts.components.length === 2 && facts.services.length === 1, 'assembleFacts: components + services gathered');
ok(facts.routes.length === 1 && facts.forms.length === 1, 'assembleFacts: routes + forms gathered');
ok(facts.packages.some((p) => p.name === 'rxjs' && p.decision === 'auto'), 'assembleFacts: package decisions carried in');
ok(facts.packageUsage.some((u) => u.name === 'rxjs' && u.count >= 1 && u.sites.some((s) => s.endsWith('app.component.ts'))), 'packageUsage: rxjs maps to the file that imports it');
ok(facts.packageUsage.some((u) => u.name === 'lodash-es'), 'packageUsage: every third-party package has a usage row');
ok(!facts.packageUsage.some((u) => u.name === '@sps-interfaces' || u.name.startsWith('@angular')), 'packageUsage: internal + @angular are NOT usage rows (third-party only)');
ok(!facts.internal.some((i) => false) && facts.internal.includes('@sps-interfaces'), 'assembleFacts: internal libs listed, not expanded');

// a unit with no entry → empty, entry null (honest, not a crash)
const emptyFacts = a.assembleFacts(join(fx, 'not-angular'));
ok(emptyFacts.entry === null && emptyFacts.files.length === 0, 'assembleFacts: no entry → empty facts, entry null');

// writeFacts serialises valid JSON to <unit>/.weave-migrate/facts.json
const factsPath = a.writeFacts(shop, facts);
try {
  ok(factsPath.endsWith('facts.json') && factsPath.includes('.weave-migrate'), 'writeFacts: writes .weave-migrate/facts.json');
  const round = JSON.parse(readFileSync(factsPath, 'utf8'));
  ok(round.components.length === 2 && round.unit === shop, 'writeFacts: the written JSON round-trips the facts');
} finally {
  rmSync(join(shop, '.weave-migrate'), { recursive: true, force: true });
}

// ── M3: the plan writer — convert order, per-piece effort, and the "can't see clearly" section ──
// A COMPONENT injects too: its edge must put the injected service EARLIER in the convert order (a real bug —
// with only service edges in the graph, AppComponent was ordered before the UserService it injects).
ok(facts.di.some((e) => e.from === 'AppComponent' && e.to === 'UserService'), 'diGraph: a component→service injection is an edge (components inject too)');
const order = pl.convertOrder(facts);
ok(order.indexOf('UserService') < order.indexOf('AppComponent'), 'convertOrder: an injected service converts BEFORE the component that injects it');
ok(order.length === 3, `convertOrder: every class is ordered (got ${order.length})`);

const items = pl.planItems(facts);
ok(items.some((i) => i.kind === 'form' && i.effort === 'needs-you'), 'planItems: a reactive form needs you (validators rarely map 1:1)');
ok(items.some((i) => i.kind === 'component' && i.name === 'app-root' && i.effort === 'needs-you' && i.note.includes('RxJS')), 'planItems: a component using RxJS needs you');
ok(items.some((i) => i.kind === 'service' && i.name === 'UserService' && i.effort === 'auto' && i.note.includes('store()')), "planItems: a providedIn:'root' service maps to store() mechanically");
ok(items.some((i) => i.kind === 'package' && i.name === 'lodash-es' && i.note.includes('Kept as-is')), 'planItems: a keep package is no work');

// the Angular → Weave mapping is honest about what it does not know
ok(pl.angularBecomes('@angular/forms').includes('@weave-framework/forms'), 'angularBecomes: @angular/forms → the forms package');
ok(pl.angularBecomes('@angular/some-unknown-thing').includes('needs you'), 'angularBecomes: an unmapped @angular entry says needs-you (never invented)');

const md = pl.renderPlan(facts);
for (const section of ['# Migration plan', '## Summary', '## Convert in this order', '## Third-party packages', '## Components', '## Services', '## Routes', '## Forms', "## Can't see clearly"]) {
  ok(md.includes(section), `renderPlan: has the "${section.replace(/^#+ /, '')}" section`);
}
ok(md.includes('not a 100% automatic'), 'renderPlan: states plainly that this is not a 100% automatic migration');
ok(md.includes('@sps-interfaces') && md.includes('migrate') , 'renderPlan: your own workspace libs are listed as separate migrations');
ok(md.includes('Nothing was hidden'), 'renderPlan: a clean analysis says so in "can\'t see clearly"');

// a unit WITH blind spots surfaces every one of them
const blindFacts = { ...facts, cycles: [['/x/a.ts', '/x/b.ts', '/x/a.ts']], unresolved: ['./missing'], calls: [{ from: 'A.m', to: '?.go', dynamic: true }] };
const blindMd = pl.renderPlan(blindFacts);
ok(blindMd.includes('Circular import'), "renderPlan: a cycle is reported in \"can't see clearly\"");
ok(blindMd.includes('./missing'), 'renderPlan: an unresolved import is reported');
ok(blindMd.includes('Dynamic call'), 'renderPlan: a dynamic call is reported');
ok(!blindMd.includes('Nothing was hidden'), 'renderPlan: with blind spots, it does NOT claim nothing was hidden');

// ── M4: the converter — Angular template → Weave template, and @Component → a setup()+html pair ──
const conv = (html, opts) => cv.convertTemplate(html, opts);

// interpolation is already the same in both
ok(conv('<h1>{{ title }}</h1>') === '<h1>{{ title }}</h1>', 'convertTemplate: {{ }} interpolation passes through');

// structural directives become Weave blocks
const ifOut = conv('<div *ngIf="user">hi</div>');
ok(ifOut.includes('@if (user) {') && ifOut.includes('<div>hi</div>'), 'convertTemplate: *ngIf → @if block wrapping the element');
const forOut = conv('<li *ngFor="let t of todos">{{ t.name }}</li>');
ok(forOut.includes('@for (t of todos; track t) {'), 'convertTemplate: *ngFor → @for with a track expression');
ok(conv('<li *ngFor="let t of todos; trackBy: byId">x</li>').includes('TODO(weave migrate)'), 'convertTemplate: trackBy is flagged (Weave tracks an expression, not a fn)');
const sw = conv('<div [ngSwitch]="s"><p *ngSwitchCase="\'a\'">A</p><p *ngSwitchDefault>D</p></div>');
ok(sw.includes('@switch (s) {') && sw.includes("@case ('a') {") && sw.includes('@default {'), 'convertTemplate: [ngSwitch]/*ngSwitchCase/*ngSwitchDefault → @switch/@case/@default');

// bindings
ok(conv('<input [value]="v" />').includes('.value={{ v }}'), 'convertTemplate: [prop] on a DOM element → .prop');
ok(conv('<app-card [item]="i"></app-card>', { components: { 'app-card': 'Card' } }).includes('<Card item={{ i }}>'), 'convertTemplate: a known selector becomes a Weave component, and its [prop] becomes a plain prop');
ok(conv('<div [class.on]="a"></div>').includes('class:on={{ a }}'), 'convertTemplate: [class.x] → class:x');
ok(conv('<div [style.color]="c"></div>').includes('style:color={{ c }}'), 'convertTemplate: [style.x] → style:x');
ok(conv('<div [attr.aria-label]="l"></div>').includes('aria-label={{ l }}'), 'convertTemplate: [attr.x] → an attribute binding');
ok(conv('<button (click)="save()"></button>').includes('on:click={{ ($event) => save() }}'), 'convertTemplate: (event)="stmt" → on:event with an arrow (Weave wants a function)');
ok(conv('<button (click)="pick($event)"></button>').includes('($event) => pick($event)'), 'convertTemplate: an $event-using statement still works after wrapping');
const model = conv('<input [(ngModel)]="name" />');
ok(model.includes('bind:value={{ name }}') && model.includes('TODO(weave migrate)'), 'convertTemplate: [(ngModel)] → bind:value, flagged because the target must be a signal');

// things with NO faithful equivalent are flagged, never invented
const ngClass = conv('<div [ngClass]="m"></div>');
ok(ngClass.includes('TODO(weave migrate)') && !ngClass.includes('class:m'), 'convertTemplate: [ngClass] is flagged, NOT invented into a class: binding');
ok(conv('<div #box></div>').includes('TODO(weave migrate)'), 'convertTemplate: a #ref is flagged (Weave uses ref={{ … }} held in setup)');
ok(conv('<ng-template><p>x</p></ng-template>').includes('TODO(weave migrate)'), 'convertTemplate: <ng-template> is flagged (a @snippet is a human call)');

// projection + grouping
ok(conv('<ng-content></ng-content>') === '<slot />', 'convertTemplate: <ng-content> → <slot />');
ok(conv('<ng-content select="[header]"></ng-content>').includes('<slot name="header" />'), 'convertTemplate: a selected <ng-content> → a named slot');
ok(conv('<ng-container *ngIf="a"><p>x</p></ng-container>').includes('@if (a) {') && !conv('<ng-container><p>x</p></ng-container>').includes('ng-container'), 'convertTemplate: <ng-container> disappears (Weave blocks already group)');

// malformed markup must not throw — a migration has to survive real-world templates
let survived = true;
try { conv('<div><p>unclosed'); conv('</stray>'); } catch { survived = false; }
ok(survived, 'convertTemplate: malformed markup is recovered, never thrown on');

// pipes: Weave has none. `| translate` is the one confident mapping; every other pipe must be FLAGGED, because
// passing it through would emit a template that only LOOKS converted (found on a real Angular library).
ok(cv.convertExpr('x | translate').expr === 't(x)', 'convertExpr: | translate → t(x)');
ok(cv.convertExpr('x | translate: p').expr === 't(x, p)', 'convertExpr: | translate with params → t(x, params)');
ok(cv.convertExpr('a || b').expr === 'a || b' && cv.convertExpr('a || b').todos.length === 0, 'convertExpr: the || operator is NOT mistaken for a pipe');
ok(cv.convertExpr("x | date:'short'").todos.length === 1, 'convertExpr: an unmapped pipe is flagged, not silently dropped');
ok(cv.convertExpr('obs | async').todos.some((t) => t.includes('()')), 'convertExpr: | async is flagged (a Weave signal is read with ())');
const tr = conv('<span>{{ crumb.text | translate }}</span>');
ok(tr.includes('{{ t(crumb.text) }}'), 'convertTemplate: a pipe inside text interpolation is converted');
const dt = conv('<span>{{ d | date }}</span>');
ok(dt.includes('TODO(weave migrate)'), 'convertTemplate: an unmapped pipe in text is flagged (never left looking converted)');
ok(conv('<span [innerHTML]="c.text | translate"></span>').includes('.innerHTML={{ t(c.text) }}'), 'convertTemplate: a pipe inside a binding is converted too');

// routerLink is a DIRECTIVE — `.routerLink` would be a silently broken invention
const rl = conv('<a [routerLink]="c.path">x</a>');
ok(!rl.includes('.routerLink') && rl.includes('href={{ c.path }}') && rl.includes('Link'), 'convertTemplate: [routerLink] → href + a TODO pointing at <Link>, never .routerLink');

// Angular's MODERN block syntax is already Weave's — it passes through, only the alias form differs
const modern = conv('@if (a()) {\n  <p>{{ x }}</p>\n}');
ok(modern.includes('@if (a()) {') && modern.includes('<p>{{ x }}</p>'), 'convertTemplate: Angular @if blocks pass through (the syntax is already Weave)');
const alias = conv('@for (c of list(); track c; let last = $last) {}');
const aliasHeader = alias.split('\n').find((l) => l.startsWith('@for')) ?? '';
ok(aliasHeader === '@for (c of list(); track c) {}', `convertTemplate: @for's \`let x = $last\` alias is dropped from the header (got ${aliasHeader})`);
ok(alias.includes('TODO(weave migrate)') && alias.includes('rename'), 'convertTemplate: the dropped alias is flagged so its uses get renamed to $last');

// the component pair
const cfact = { file: 'x/task-card.component.ts', className: 'TaskCardComponent', selector: 'app-task-card', standalone: true, inputs: ['task'], outputs: ['remove'], templateInline: false, templateUrl: './t.html', styleUrls: [], inlineStyles: 0, injects: ['UserService'] };
const pair = cv.convertComponent(cfact, '<h3 *ngIf="task">{{ task.title }}</h3>');
ok(pair.baseName === 'task-card', `convertComponent: base name from the selector (got ${pair.baseName})`);
ok(pair.ts.includes('export function setup(') && pair.ts.includes('task: unknown'), 'convertComponent: a setup() with the @Input as a prop');
ok(pair.ts.includes('onRemove?:'), 'convertComponent: an @Output becomes an onX callback prop');
ok(pair.ts.includes('UserService') && pair.ts.includes('TODO(weave migrate)'), 'convertComponent: injected services are flagged for the store()/provide decision');
ok(pair.html.includes('@if (task) {'), 'convertComponent: the template is converted alongside');
ok(cv.pascalCase('app-task-card') === 'AppTaskCard', 'pascalCase: a selector becomes a component name');

// ── the TARGET: you run `weave migrate` from inside the Weave app you migrate INTO; the source is only read ──
const tgt = mkdtempSync(join(tmpdir(), 'weave-target-'));
try {
  ok(m.resolveTarget(tgt).isWeave === false, 'resolveTarget: a plain folder is not a Weave app');
  writeFileSync(join(tgt, 'package.json'), '{"dependencies":{"@weave-framework/runtime":"^2.0.0"}}');
  ok(m.looksLikeWeaveApp(tgt), 'looksLikeWeaveApp: a @weave-framework/* dependency marks a Weave app');
  const t = m.resolveTarget(tgt);
  ok(t.isWeave === true && t.dir === tgt, 'resolveTarget: resolves to the given directory, flagged as Weave');

  // END-TO-END, because this is the guarantee that matters: run the real command with cwd = the target app and
  // assert WHERE it wrote. (Calling writeFacts(tgt) directly would prove nothing — the risk is the COMMAND
  // passing the source app instead of the target, which only a real run can catch.)
  const srcBefore = readdirSync(shop).sort().join(',');
  execFileSync(process.execPath, [join(repo, 'packages', 'cli', 'bin', 'weave.mjs'), 'migrate'], {
    cwd: tgt,
    input: `1\n${shop}\n\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ok(existsSync(join(tgt, '.weave-migrate', 'facts.json')), 'weave migrate: facts.json lands in the TARGET app (cwd)');
  ok(existsSync(join(tgt, 'migration-plan.md')), 'weave migrate: migration-plan.md lands in the TARGET app (cwd)');
  ok(!existsSync(join(shop, 'migration-plan.md')) && !existsSync(join(shop, '.weave-migrate')), 'weave migrate: writes NOTHING into the source Angular app');
  ok(readdirSync(shop).sort().join(',') === srcBefore, 'weave migrate: the source app\'s contents are unchanged (it is only read)');
} finally {
  rmSync(tgt, { recursive: true, force: true });
}

// a weave.config.* also marks a Weave app
const tgt2 = mkdtempSync(join(tmpdir(), 'weave-target2-'));
try {
  writeFileSync(join(tgt2, 'weave.config.ts'), 'export default {};');
  ok(m.looksLikeWeaveApp(tgt2), 'looksLikeWeaveApp: a weave.config.ts marks a Weave app');
} finally {
  rmSync(tgt2, { recursive: true, force: true });
}

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
rmSync(outP, { force: true });
rmSync(outC, { force: true });
rmSync(outUi, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ weave migrate M1 + M2.1 — path resolution + entry-point discovery.');
