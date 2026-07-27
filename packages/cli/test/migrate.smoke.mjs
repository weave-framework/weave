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
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const fx = join(here, 'fixtures', 'migrate');

const NL = String.fromCharCode(10);
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

// Bundle Weave's OWN compiler: a converted template has to be one Weave can actually compile. Every `html`
// assertion below checks the shape of a string; only this checks the thing is usable.
const outW = join(repo, 'node_modules', '.weave-migrate-compiler-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'compiler', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outW,
});
const wc = await import(pathToFileURL(outW).href);

// Bundle the RxJS translator — the module that removes the streams instead of describing them.
const outRx = join(repo, 'node_modules', '.weave-migrate-rxjs-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-rxjs.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outRx,
});
const rx = await import(pathToFileURL(outRx).href);

// Bundle the output verifier (the whole-result check that the per-file pipeline cannot do).
const outV = join(repo, 'node_modules', '.weave-migrate-verify-smoke.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'cli', 'src', 'migrate-verify.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: outV,
});
const vf = await import(pathToFileURL(outV).href);
/** Does Weave's compiler accept this converted template? Returns the error message, or '' when it compiles. */
const compilesAsWeave = (html) => {
  // A TODO comment is guidance for the reader, not markup — and an unresolved TODO is not a compiler error.
  try {
    wc.compileTemplate(html);
    return '';
  } catch (e) {
    return String(e?.message ?? e);
  }
};

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
// <ng-template #ref let-x let-y="key"> → @snippet, and *ngTemplateOutlet → @render with ordered arguments.
ok(conv('<ng-template><p>x</p></ng-template>').includes('TODO(weave migrate)'), 'convertTemplate: an UNNAMED <ng-template> is flagged (a @snippet needs a name to be rendered)');
const snip = conv('<ng-template #row let-item let-last="last"><li>{{ item }}</li></ng-template>');
ok(snip.includes('@snippet row(item, last) {') && snip.includes('<li>{{ item }}</li>'), 'convertTemplate: a named <ng-template> becomes @snippet with its let- bindings as parameters');
// The context is written flag-FIRST while the snippet declares item first — so this fails if the arguments are
// emitted in context order rather than parameter order. Written the other way round the check is vacuous.
const outlet = conv('<ng-template #row let-item let-flag="flag"><li></li></ng-template><ng-container *ngTemplateOutlet="row; context: { flag: isOn(x, y), $implicit: user }"></ng-container>');
ok(outlet.includes('@render (row(user, isOn(x, y)))'), `convertTemplate: *ngTemplateOutlet arguments follow the SNIPPET's parameter order, not the context's`);
const partial = conv('<ng-template #row let-item let-flag="flag"><li></li></ng-template><ng-container *ngTemplateOutlet="row; context: { $implicit: u }"></ng-container>');
ok(partial.includes('@render (row(u, undefined))') && partial.includes('TODO(weave migrate)'), 'convertTemplate: a context missing a parameter passes undefined AND says so');
// An outlet whose template lives in another file cannot be resolved — flagged, never invented.
ok(conv('<ng-container *ngTemplateOutlet="elsewhere"></ng-container>').includes('no <ng-template #elsewhere>'), 'convertTemplate: an unresolvable outlet is flagged by name');
// The outlet may appear BEFORE its template — the collection pass runs first.
ok(conv('<ng-container *ngTemplateOutlet="later; context: { $implicit: v }"></ng-container><ng-template #later let-a><b></b></ng-template>').includes('@render (later(v))'), 'convertTemplate: an outlet is resolved even when it precedes its <ng-template>');
ok(cv.parseOutlet('tpl; context: { $implicit: a, k: f(1, 2) }').context.k === 'f(1, 2)', 'parseOutlet: a context value containing commas is not split apart');

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

ok(conv('<router-outlet></router-outlet>').includes('<RouterView>'), 'convertTemplate: <router-outlet> → <RouterView> (@weave-framework/router)');

// Reactive-forms directives → use:control. ORDERING matters: each of these also matches a general rule
// ((ngSubmit) looks like any event, [formControl] like any property binding), so they must be tried first —
// they were dead code until moved above those rules.
ok(conv('<input formControlName="email" />').includes('use:control={{ f.controls.email }}'), 'convertTemplate: formControlName → use:control on the group child');
ok(conv('<input [formControl]="ctrl" />').includes('use:control={{ ctrl }}'), 'convertTemplate: [formControl] → use:control (NOT a .formControl property)');
const fg = conv('<form [formGroup]="f"></form>');
ok(!fg.includes('.formGroup') && fg.includes('TODO(weave migrate)'), 'convertTemplate: [formGroup] is dropped with a TODO (the group lives in setup)');
const sub = conv('<form (ngSubmit)="save()"></form>');
ok(sub.includes('on:submit|preventDefault={{ submit }}') && !sub.includes('($event) => save()'), 'convertTemplate: (ngSubmit) → the forms submit binding, not a generic event handler');

// a component that uses reactive forms gets its form drafted into the same setup()
const loginFact = { file: 'x/login.component.ts', className: 'LoginComponent', selector: 'app-login', standalone: true, inputs: [], outputs: [], templateInline: false, templateText: null, templateUrl: null, styleUrls: [], inlineStyles: 0, injects: [] };
const formPair = cv.convertComponent(loginFact, '<form></form>', {}, { file: 'x', className: 'LoginComponent', primitives: ['FormGroup', 'FormControl'], controls: ['email', 'password'] });
ok(formPair.ts.includes("import { field, form } from '@weave-framework/forms';"), 'convertComponent: a forms component imports the forms package');
ok(formPair.ts.includes('const f = form({') && formPair.ts.includes("email: field('')") && formPair.ts.includes("password: field('')"), 'convertComponent: each control becomes a field in the form');
ok(formPair.ts.includes('const submit = f.submit(async (values)'), 'convertComponent: a submit handler is drafted via f.submit');
ok(formPair.ts.includes('exactly seven validators'), 'convertComponent: the draft names the validators Weave actually ships (so none get invented)');
ok(!cv.convertComponent(loginFact, '<p></p>', {}).ts.includes('@weave-framework/forms'), 'convertComponent: a component with no form gets no forms import');

// the component pair
const cfact = { file: 'x/task-card.component.ts', className: 'TaskCardComponent', selector: 'app-task-card', standalone: true, inputs: ['task'], outputs: ['remove'], templateInline: false, templateUrl: './t.html', styleUrls: [], inlineStyles: 0, injects: ['UserService'], members: [] };
const pair = cv.convertComponent(cfact, '<h3 *ngIf="task">{{ task.title }}</h3>');
ok(pair.baseName === 'task-card', `convertComponent: base name from the selector (got ${pair.baseName})`);
ok(pair.ts.includes('export function setup(') && pair.ts.includes('task: unknown'), 'convertComponent: a setup() with the @Input as a prop');
ok(pair.ts.includes('onRemove?:'), 'convertComponent: an @Output becomes an onX callback prop');
ok(pair.ts.includes('UserService') && pair.ts.includes('TODO(weave migrate)'), 'convertComponent: injected services are flagged for the store()/provide decision');
// An Angular template reads an @Input by its bare name; a Weave one reads it off `props`. Left bare, the binding
// does not resolve and the component renders nothing — found on a real migrated component.
ok(pair.html.includes('@if (props.task) {'), 'convertComponent: a template reference to an @Input becomes props.x');
ok(cv.qualifyProps('flowLabel', ['flowLabel']) === 'props.flowLabel', 'qualifyProps: a bare prop name is qualified');
ok(cv.qualifyProps('svg?.name', ['svg']) === 'props.svg?.name', 'qualifyProps: an optional chain on a prop still qualifies');
ok(cv.qualifyProps('x.color', ['color']) === 'x.color', 'qualifyProps: a PROPERTY of something else is left alone');
ok(cv.qualifyProps("'color'", ['color']) === "'color'", 'qualifyProps: a string literal is never rewritten');
ok(cv.qualifyProps('colorful', ['color']) === 'colorful', 'qualifyProps: a longer identifier starting with a prop name is untouched');
ok(cv.qualifyProps('a', []) === 'a', 'qualifyProps: no props → nothing changes');
// A snippet parameter is a LOCAL, not a prop, even when the names collide.
const shadow = conv('<ng-template #row let-color><b>{{ color }}</b></ng-template>', { props: ['color'] });
ok(shadow.includes('{{ color }}'), 'convertTemplate: a snippet parameter shadows a prop and is NOT qualified');
ok(cv.pascalCase('app-task-card') === 'AppTaskCard', 'pascalCase: a selector becomes a component name');

// ── translating a body: `this.x` is a mechanical rename, not a judgement call ──
// A getter returning `size(this.routerLink) > 0` came out as `computed(() => undefined)`: not incomplete but
// WRONG — a host class that was always applied became one that never is. Bodies are translated now.
const tctx = cv.translateCtx(
  [
    { kind: 'field', name: 'count', isSignal: false, initializer: '0', params: '', body: '', type: 'number', text: '', isPublic: true },
    { kind: 'field', name: 'sig', isSignal: true, initializer: 'signal(0)', params: '', body: '', type: '', text: '', isPublic: true },
    { kind: 'field', name: 'router', isSignal: false, initializer: 'inject(Router)', params: '', body: '', type: '', text: '', isPublic: false },
    { kind: 'getter', name: 'ready', isSignal: false, initializer: '', params: '', body: 'return true;', type: '', text: '', isPublic: true },
    { kind: 'method', name: 'refresh', isSignal: false, initializer: '', params: '', body: '', type: '', text: '', isPublic: true },
  ],
  ['label'],
);
ok(cv.translateBody('return this.label;', tctx).code === 'return props.label;', 'translateBody: an @Input is read off props');
ok(cv.translateBody('return this.count;', tctx).code === 'return count();', 'translateBody: a plain field is read as a signal');
ok(cv.translateBody('this.sig.set(1);', tctx).code === 'sig.set(1);', 'translateBody: a field that was ALREADY a signal is renamed bare — not sig().set(1)');
ok(cv.translateBody('this.count = 5;', tctx).code === 'count.set(5);', 'translateBody: a field write becomes a signal write');
ok(cv.translateBody('return this.ready;', tctx).code === 'return ready();', 'translateBody: a getter is read as a computed');
ok(cv.translateBody('this.refresh();', tctx).code === 'refresh();', 'translateBody: a method call drops `this.`');
ok(cv.translateBody('this.router.navigate(this.label);', tctx).code === 'routerNavigate(props.label);', "translateBody: an injected Router's navigate becomes the shim that has Angular's shape");
ok(cv.translateBody("return 'this.count';", tctx).code === "return 'this.count';", 'translateBody: a string literal is never rewritten');
const unresolved = cv.translateBody('return this.mystery;', tctx);
ok(unresolved.todos.some((t) => t.includes('mystery')), 'translateBody: a `this.` with no counterpart is REPORTED, not silently renamed');
const shadowed = cv.translateBody('this.count = count;', tctx, 'count: number');
ok(shadowed.todos.some((t) => t.includes('parameter')), 'translateBody: a parameter colliding with a signal name is flagged');
// A right-hand side containing STRING LITERALS. The old rule matched with a regex over text already split on
// quotes, so it could not see past the first one: `this.x = on ? 'a' : 'b'` came out as `x.set(on ?)'a' : 'b'`.
ok(cv.translateBody("this.count = on ? 'a' : 'b';", tctx).code === "count.set(on ? 'a' : 'b');", 'translateBody: a field write carries its WHOLE right-hand side, string literals and all');
ok(cv.translateBody('this.count = { a: 1, b: [2, 3] };', tctx).code === 'count.set({ a: 1, b: [2, 3] });', 'translateBody: an object/array right-hand side is not cut at its first brace');
ok(cv.translateBody('if (this.count === 1) { return; }', tctx).code === 'if (count() === 1) { return; }', 'translateBody: `===` is a comparison, never mistaken for an assignment');
ok(cv.translateBody('const f = () => this.count;', tctx).code === 'const f = () => count();', 'translateBody: `=>` is not an assignment either');

// A template reads a field bare in Angular; in Weave it must CALL the signal, or it renders the function itself.
ok(cv.qualifySignalReads('label', ['label']) === 'label()', 'qualifySignalReads: a bare signal name is called');
ok(cv.qualifySignalReads('label()', ['label']) === 'label()', 'qualifySignalReads: an already-called signal is not called twice');
ok(cv.qualifySignalReads('x.label', ['label']) === 'x.label', 'qualifySignalReads: a property of something else is left alone');
ok(cv.qualifySignalReads("'label'", ['label']) === "'label'", 'qualifySignalReads: a string literal is never rewritten');

// A getter becomes a computed that DOES what it did.
ok(cv.getterToComputed('return true;', tctx).code === 'computed(() => true)', 'getterToComputed: `return true` becomes computed(() => true), not computed(() => undefined)');
ok(cv.getterToComputed('return size(this.label) > 0;', tctx).code === 'computed(() => size(props.label) > 0)', 'getterToComputed: the real expression is carried, props and all');

// The translated body keeps calling what the original called, so those imports must travel with it.
const carriedImports = cv.carriedImportsFor(join(comps, 'typed.component.ts'));
ok(!carriedImports.some((i) => i.includes('@angular/')), 'carriedImportsFor: @angular imports are dropped — that is the framework being left');

// ── an @Input states a TYPE and a DEFAULT; both used to be discarded, and getters vanished entirely ──
const typedFact = a.findComponents(join(comps, 'typed.component.ts'))[0];
ok(typedFact.members.some((m) => m.kind === 'getter' && m.name === 'hasColor'), 'findComponents: a getter is captured (nothing captured accessors before)');
ok(typedFact.members.find((m) => m.name === 'color')?.type === 'string', "findComponents: an @Input's declared TYPE is captured");
ok(typedFact.members.find((m) => m.name === 'color')?.initializer === "'sps-default'", "findComponents: an @Input's DEFAULT is captured");

const typedTs = cv.convertComponent(typedFact, '<b>{{ label }}</b>', {}).ts;
ok(typedTs.includes('color: string;') && typedTs.includes('enabled: boolean;') && typedTs.includes('items: string[];'), 'convertComponent: the props signature carries the declared types, not `unknown`');
// A defaulted prop is NOT optional inside setup — propDefaults guarantees it a value there. Marking it `?` forced
// a null check on something that is never null, which the compile gate rejected.
ok(!typedTs.includes('color?:'), 'convertComponent: a defaulted prop is not made optional in the signature — propDefaults is what makes it optional for the PARENT');
ok(typedTs.includes('required: number;'), 'convertComponent: an @Input with no default keeps its declared type');
ok(typedTs.includes('export const propDefaults = {') && typedTs.includes("color: 'sps-default',") && typedTs.includes('enabled: true,'), 'convertComponent: the declared defaults become propDefaults — Weave\'s own mechanism for exactly this');
// Scoped to the propDefaults BLOCK: `label:` also appears in the props type below it, so a whole-file search
// would pass no matter what the block contained.
const defaultsBlock = typedTs.slice(typedTs.indexOf('propDefaults = {'), typedTs.indexOf('};', typedTs.indexOf('propDefaults = {')));
ok(!defaultsBlock.includes('label:'), 'convertComponent: a `= null` default is not carried — a missing prop already reads as absent');
ok(typedTs.includes('const hasColor = computed(') && typedTs.includes('get hasColor()'), 'convertComponent: a getter becomes a computed, with its original beside it');
// Imports follow what the body uses: this component's fields are all @Inputs (so no `signal`), but it has a
// getter (so `computed`). Neither a missing nor a dead import.
ok(typedTs.includes("import { computed } from '@weave-framework/runtime';"), 'convertComponent: computed is imported for the getter, and signal is not imported when nothing needs it');
// The whole-class guarantee still holds with accessors in play.
const typedLost = typedFact.classBody.split('\n').map((l) => l.trim()).filter((l) => l && l !== '}' && l !== '{').filter((l) => !typedTs.includes(l));
ok(typedLost.length === 0, `NOTHING IS LOST (accessors): every line survives (lost: ${typedLost.join(' | ') || 'none'})`);

// ── the HOST element: @HostBinding / @HostListener / host: { … } ──
// A @HostBinding getter became a `computed` that NOTHING READ, so `class.sps-logo` — always applied in Angular —
// became a class that is never applied. The computed was right and the component was still broken.
const hostFact = a.findComponents(join(comps, 'host.component.ts'))[0];
ok(hostFact.hostMeta.class === 'sps-block', 'findComponents: the decorator\'s `host: { class: … }` is read (it used to be read past entirely)');
ok(hostFact.hostMeta['(mouseenter)'] === 'hover(true)', 'findComponents: a host listener declared in `host: {}` is read');
ok(hostFact.declaredImports.includes('RouterModule'), 'findComponents: the decorator\'s `imports: []` is recorded');
ok(hostFact.members.find((mem) => mem.name === 'classSpsLogo')?.decorators.some((d) => d.includes('HostBinding')), 'classMembers: a member\'s @HostBinding decorator is captured');

const hostPair = cv.convertComponent(hostFact, '<div class="wrap"><span>{{ label }}</span></div>', {});
ok(hostPair.html.includes('class:sps-logo={{ classSpsLogo() }}'), 'host: @HostBinding(class.x) becomes a class: on the root element — the computed is now READ');
ok(hostPair.html.includes('class:cursor-pointer={{ classCursorPointer() }}'), 'host: every class binding lands, not just the first');
ok(hostPair.html.includes("style:width={{ (widthPx()) + 'px' }}"), 'host: `style.width.px` keeps the UNIT — without it the value is not a length and does nothing');
ok(hostPair.html.includes('aria-label={{ label() }}'), 'host: @HostBinding on a FIELD reads that field\'s signal');
ok(hostPair.html.includes('role={{ props.role }}'), 'host: a `host: {}` binding resolves against the class — an @Input reads off props');
ok(hostPair.html.includes('on:click={{ ($event) => onClick() }}'), 'host: @HostListener becomes an on: handler on the root — it used to be a function nothing called');
ok(hostPair.html.includes('on:mouseenter={{ ($event) => hover(true) }}'), 'host: a listener declared in `host: {}` is wired too');
// The static class MERGES: a second `class=` attribute on one element is not additive, it is a bug.
ok(hostPair.html.includes('class="sps-block wrap"'), 'host: a static host class merges into the root\'s own class attribute');
ok((hostPair.html.match(/\sclass="/g) ?? []).length === 1, 'host: exactly ONE class attribute on the root — never a duplicate that silently wins');
// window:/document: is a subscription, not an element binding — and it must be UNsubscribed.
ok(!hostPair.html.includes('resize'), 'host: a window: listener is NOT put on the element (it would listen to the wrong thing)');
ok(hostPair.ts.includes("window.addEventListener('resize'") && hostPair.ts.includes("window.removeEventListener('resize'"), 'host: a window: listener becomes an onMount subscription WITH its cleanup');
ok(hostPair.ts.includes('onMount') && /import \{[^}]*onMount[^}]*\} from '@weave-framework\/runtime'/.test(hostPair.ts), 'host: onMount is imported when the subscription needs it');
// No single root: there is no honest place for host bindings, so it is REPORTED, never dropped.
const multiRoot = cv.convertComponent(hostFact, '<b>one</b><i>two</i>', {});
ok(multiRoot.html.includes('TODO(weave migrate)') && multiRoot.html.includes('root elements'), 'host: with no single root element the bindings are reported in full, not silently dropped');
ok(!/<[bi][ >][^>]*class:sps-logo/.test(multiRoot.html), 'host: nothing is attached to an arbitrary element when there is no single root');
// A field holds what it HELD.
ok(hostPair.ts.includes("const label = signal<string>('the logo');"), 'signalDecl: a field keeps its declared type AND its initial value — signal<unknown>(undefined) was wrong from the first frame');
ok(hostPair.ts.includes('const lastSeen = signal<Date | undefined>(undefined);'), 'signalDecl: an uninitialised field is a signal of `T | undefined`, and `lastSeen: Date` is STATE, not an injected service');
// A component holds streams too, and its signatures follow the translated bodies for the same reason a service's do.
ok(hostPair.ts.includes('const labelWidth = (): number =>'), 'host: a translated component method no longer says it returns an Observable');
ok(hostPair.ts.includes('return label().length;'), 'host: the chain inside a component folds like any other');
ok(!/from 'rxjs/.test(hostPair.ts), 'host: a component whose streams all translated imports nothing from rxjs');
ok(hostPair.ts.includes('const hasRoute = computed(() => props.routerLink.length > 0);'), 'host: the getter behind a host binding is translated, not stubbed');
// `: void` on every drafted function made a method ending in `return false;` a type error. The source either
// declared a return type or said nothing and let TypeScript work it out — neither of those is `void`.
ok(hostPair.ts.includes('const onClick = () => {'), 'returnAnnotation: an undeclared return type is INFERRED, not forced to void — the body returns a value');
ok(hostPair.ts.includes('const hover = (on: boolean): void => {'), 'returnAnnotation: a body that returns nothing is still `: void`');
ok(cv.returnAnnotation({ type: 'boolean' }, 'return true;') === ': boolean', 'returnAnnotation: a DECLARED return type is carried, never replaced');
// Angular's Router.navigate takes an array of COMMANDS and returns a Promise; Weave's navigate takes a path and
// returns nothing. Mapping them 1:1 read fine and compiled nowhere.
ok(hostPair.ts.includes('const routerNavigate = (commands: unknown, opts?: NavigateOptions): void =>'), 'adaptersFor: the shim is a plain function — a Promise that always resolves true is not a promise, it is a disguise');
ok(hostPair.ts.includes("routerNavigate([props.routerLink, 'x']);"), "adaptersFor: the ARRAY of commands still works — that is the only difference the shim exists for");
// Weave's navigation is synchronous, so "after the navigation" is simply the next statement.
ok(!hostPair.ts.includes('.then(') || !/routerNavigate\([^;]*\)\.then/.test(hostPair.ts), 'unwrapSyncThen: no `.then()` is left hanging off a call that returns nothing');
ok(/routerNavigate\(\[props\.routerLink, 'x'\]\);\s*\n\s*hover\(true\);/.test(hostPair.ts), 'unwrapSyncThen: the callback BODY becomes the statements that follow the call, not a dropped block');
const thenTodos = [];
ok(cv.unwrapSyncThen('navigate("/a").then((ok) => { use(ok); });', ['navigate'], thenTodos).includes('const ok = true;'), "unwrapSyncThen: a callback PARAMETER was Angular's result — bound to what the success path saw");
ok(thenTodos.some((t) => t.includes('guard cancelled')), 'unwrapSyncThen: and the case Weave cannot report is stated, not hidden');
const valueTodos = [];
ok(cv.unwrapSyncThen('return navigate("/a").then(() => 1);', ['navigate'], valueTodos).includes('.then('), 'unwrapSyncThen: a `.then()` used as a VALUE is left alone — unwrapping it would silently drop the callback');
ok(valueTodos.some((t) => t.includes('as a VALUE')), 'unwrapSyncThen: and that case is reported');
ok(hostPair.ts.includes("import { navigate, type NavigateOptions } from '@weave-framework/router';"), 'adaptersFor: the shim brings its own imports');
// A dependency whose calls were REWRITTEN needs nothing from the reader; saying "make it a store()" contradicted
// the `routerNavigate(…)` three lines below it and asked for work already done.
ok(!hostPair.ts.includes('this component injected Router'), 'convertComponent: an ANSWERED dependency is not also listed as work still to do');
ok(hostPair.ts.includes('imports: [RouterModule]'), "convertComponent: the decorator's `imports: []` is accounted for in the output, not just read");
ok(!/import \{[^}]*\bsignal\b/.test(hostPair.ts.split('export function setup')[0]) || hostPair.ts.includes('= signal'), 'convertComponent: `signal` is imported only when something actually calls it');
// Scoped to the SPAN: `aria-label={{ label() }}` from the host binding also contains that text, so a whole-file
// search passed with the template rule switched off entirely.
ok(hostPair.html.includes('<span>{{ label() }}</span>'), 'convertComponent: a template reading a FIELD calls its signal — `{{ label }}` would render the function');
// A drafted block is multi-line; prefixing the ENTRY only indented its first line, so bodies hung outside setup().
ok(hostPair.ts.includes("\n      routerNavigate([props.routerLink, 'x']);\n      hover(true);"), 'convertComponent: every line of a multi-line draft is indented inside setup(), and an unwrapped statement takes the indentation of the call it follows');
const hostLost = hostFact.classBody.split('\n').map((l) => l.trim()).filter((l) => l && l !== '}' && l !== '{').filter((l) => !hostPair.ts.includes(l));
ok(hostLost.length === 0, `NOTHING IS LOST (host): every line survives (lost: ${hostLost.join(' | ') || 'none'})`);

// The decisive gate for the TEMPLATE half: Weave's own compiler has to accept what the converter emits. The
// detector is checked against known-bad markup first, so a gate that can never fail is not mistaken for a pass.
ok(compilesAsWeave('@if (a) { <b>x</b>') !== '', 'the template compile gate really detects a broken template (an unclosed block)');
for (const [name, html] of [['host', hostPair.html], ['multi-root', multiRoot.html], ['task-card', pair.html]]) {
  const err = compilesAsWeave(html);
  ok(err === '', `the converted ${name} template COMPILES with Weave's own compiler${err ? ` — ${err}` : ''}`);
}

// The decorator-call reader, on its own.
ok(cv.decoratorArgs("@HostListener('click', ['$event'])", 'HostListener').length === 2, 'decoratorArgs: the argument list is split on TOP-LEVEL commas only (the array stays one argument)');
ok(cv.decoratorArgs('@HostBinding', 'HostBinding').length === 0, 'decoratorArgs: a bare decorator yields an empty list, not null');
ok(cv.decoratorArgs('@Input()', 'HostBinding') === null, 'decoratorArgs: a different decorator is not mistaken for this one');
ok(cv.hostTargetToAttr('attr.role', 'x()') === 'role={{ x() }}', 'hostTargetToAttr: attr.* is a plain attribute');
ok(cv.hostTargetToAttr('disabled', 'x()') === '.disabled={{ x() }}', 'hostTargetToAttr: a bare target is a DOM PROPERTY, not an attribute');

// signal-input defaults live inside the call
ok(cv.signalInputDefault({ initializer: "input('')" }) === "''", 'signalInputDefault: input(x) defaults to x');
ok(cv.signalInputDefault({ initializer: 'input.required<number>()' }) === '', 'signalInputDefault: input.required has no default by definition');
ok(cv.signalInputDefault({ initializer: 'input(5, { alias: "n" })' }) === '5', 'signalInputDefault: the options bag is not mistaken for the default');
ok(cv.signalInputDefault({ initializer: 'null' }) === '', 'signalInputDefault: an explicit null is not a default worth carrying');

// ── M5: the hard parts DRAFTED — service → store()/context, RxJS → targeted suggestions ──
const rootSvc = {
  file: 'x/user.service.ts', className: 'UserService', providedIn: 'root', methods: ['logout'], fields: ['user'], signals: ['user'], injects: ['Router'],
  members: [
    { kind: 'constructor', name: '(constructor)', isPublic: true, params: 'private router: Router', body: '', initializer: '', isSignal: false, text: 'constructor(private router: Router) {}' },
    { kind: 'field', name: 'user', isPublic: true, params: '', body: '', initializer: 'signal(null)', isSignal: true },
    { kind: 'method', name: 'logout', isPublic: true, params: '', body: "this.user.set(null);\nthis.router.navigate(['/login']);\nthis.router.navigateByUrl('/home');", initializer: '', isSignal: false },
  ],
};
const rootDraft = cv.convertService(rootSvc);
ok(rootDraft.ts.includes("import { store } from '@weave-framework/store'"), 'convertService: a root service imports store');
ok(rootDraft.ts.includes('export const useUser = store(() => {'), 'convertService: providedIn:root → a store() with a useX hook');
ok(rootDraft.ts.includes('const user = signal(null);') && rootDraft.ts.includes('1:1 move'), 'convertService: a field that was already a signal is a 1:1 move — its initial value included, not re-wrapped');
ok(rootDraft.ts.includes('const logout = (): void => {'), 'convertService: a method becomes a function');

// A method's SIGNATURE and its ORIGINAL BODY are carried across. Both used to be dropped: the draft emitted an
// empty stub with no parameters, so porting meant reading the Angular file side by side for every method.
const apiSvc = a.findServices(join(svcs, 'api.service.ts'))[0];
ok(apiSvc.methodSources.get.params === 'url: string', `findServices: a method's parameter list is captured verbatim (got "${apiSvc.methodSources.get.params}")`);
ok(apiSvc.methodSources.post.params.includes('body: unknown'), 'findServices: every parameter is captured, not just the first');
const bodySvc = a.findServices(join(svcs, 'with-body.service.ts'))[0];
ok(bodySvc.methodSources.apply.body.includes('this.count = n;'), "findServices: the method's original body is captured");
const bodyDraft = cv.convertService(bodySvc);
ok(bodyDraft.ts.includes('const apply = (n: number): void => {'), 'convertService: the drafted function keeps the original signature');
ok(/\/\/\s+this\.count = n;/.test(bodyDraft.ts), 'convertService: the original body is carried across, commented (so the draft still compiles)');
ok(bodyDraft.ts.includes('original WithBodyService.apply()'), 'convertService: the carried body is labelled with where it came from');
ok(rootDraft.ts.includes('return { user, logout };'), 'convertService: the returned object is the service surface');
ok(rootDraft.ts.includes('const routerNavigate = ('), 'convertService: a service gets the same shim its rewritten calls name');
// `navigateByUrl` already takes the path — wrapping it too would be machinery around nothing.
ok(rootDraft.ts.includes("navigate('/home');") && !rootDraft.ts.includes("routerNavigate('/home')"), 'SERVICE_METHODS: navigateByUrl is `navigate` outright — only the ARRAY form needs a shim');
// A shim and a direct call can both need something from the same module. Two import lines is a duplicate identifier.
ok((rootDraft.ts.match(/from '@weave-framework\/router'/g) ?? []).length === 1, 'serviceImportsFor: names are collected per MODULE — one import line, however many things need it');
ok(rootDraft.baseName === 'user', `serviceBaseName: UserService → user (got ${rootDraft.baseName})`);

const scopedSvc = {
  file: 'x/scoped.service.ts', className: 'ScopedService', providedIn: null, methods: ['doThing'], fields: [], signals: [], injects: [],
  members: [{ kind: 'method', name: 'doThing', isPublic: true, params: '', body: '', initializer: '', isSignal: false }],
};
const scopedDraft = cv.convertService(scopedSvc);
ok(scopedDraft.ts.includes('createContext') && scopedDraft.ts.includes('ScopedContext'), 'convertService: a service with NO providedIn becomes a context, not a global store');
ok(!scopedDraft.ts.includes('store('), 'convertService: a scoped service is NOT turned into a global store');
ok(scopedDraft.ts.includes('export function createScopedService()'), 'convertService: the context gets a factory to provide');

// RxJS guidance is TARGETED at what the file actually imports, and honest about what it does not know
ok(cv.rxjsSuggestions(['BehaviorSubject'])[0].includes('signal'), 'rxjsSuggestions: BehaviorSubject → signal');
ok(cv.rxjsSuggestions(['takeUntilDestroyed'])[0].includes('onDispose'), 'rxjsSuggestions: takeUntilDestroyed → onDispose');
ok(cv.rxjsSuggestions(['weirdOperator'])[0].includes('no recorded equivalent'), 'rxjsSuggestions: an unknown operator is named honestly, never invented');
// Operators that are really COLLECTION work must give the plain-JS one-liner, not a shrug: a real service's
// `mergeMap(xs => xs) → distinct(x => x.text) → toArray()` chain is just an array de-duplication.
for (const [op, expect] of [['distinct', 'new Map'], ['toArray', 'already have the array'], ['concat', '...a, ...b'], ['first', 'await']]) {
  const hint = cv.rxjsSuggestions([op])[0];
  ok(hint.includes(expect) && !hint.includes('no recorded equivalent'), `rxjsSuggestions: ${op} gives its plain-JS equivalent, not a shrug`);
}
// Coverage over the WHOLE RxJS 7 surface, by category — an Angular app can import any of these, and a shrug
// is the least useful answer the tool can give. (Measured, not assumed: this list started at 56/129 covered.)
const RXJS_SURFACE = [
  // creation
  'ajax', 'bindCallback', 'bindNodeCallback', 'defer', 'empty', 'from', 'fromEvent', 'fromEventPattern', 'generate', 'interval', 'of', 'range', 'throwError', 'timer', 'iif',
  // join creation
  'combineLatest', 'concat', 'forkJoin', 'merge', 'partition', 'race', 'zip',
  // transformation
  'buffer', 'bufferCount', 'bufferTime', 'bufferToggle', 'bufferWhen', 'concatMap', 'concatMapTo', 'exhaust', 'exhaustMap', 'expand', 'groupBy', 'map', 'mapTo', 'mergeMap', 'mergeMapTo', 'mergeScan', 'pairwise', 'pluck', 'scan', 'switchScan', 'switchMap', 'switchMapTo', 'window', 'windowCount', 'windowTime', 'windowToggle', 'windowWhen',
  // filtering
  'audit', 'auditTime', 'debounce', 'debounceTime', 'distinct', 'distinctUntilChanged', 'distinctUntilKeyChanged', 'elementAt', 'filter', 'first', 'ignoreElements', 'last', 'sample', 'sampleTime', 'single', 'skip', 'skipLast', 'skipUntil', 'skipWhile', 'take', 'takeLast', 'takeUntil', 'takeWhile', 'throttle', 'throttleTime',
  // join operators
  'combineLatestAll', 'concatAll', 'exhaustAll', 'mergeAll', 'startWith', 'withLatestFrom',
  // multicasting
  'multicast', 'publish', 'publishBehavior', 'publishLast', 'publishReplay', 'share', 'shareReplay', 'connectable',
  // errors
  'catchError', 'retry', 'retryWhen',
  // utility
  'tap', 'delay', 'delayWhen', 'dematerialize', 'materialize', 'observeOn', 'subscribeOn', 'timeInterval', 'timestamp', 'timeout', 'timeoutWith', 'toArray', 'finalize',
  // conditional + mathematical
  'defaultIfEmpty', 'every', 'find', 'findIndex', 'isEmpty', 'sequenceEqual', 'count', 'max', 'min', 'reduce',
  // types + plumbing
  'Observable', 'Subject', 'BehaviorSubject', 'ReplaySubject', 'AsyncSubject', 'Subscription', 'firstValueFrom', 'lastValueFrom', 'EMPTY', 'NEVER', 'pipe', 'asyncScheduler', 'subscribe', 'takeUntilDestroyed', 'animationFrames',
];
const uncovered = RXJS_SURFACE.filter((n) => cv.rxjsSuggestions([n])[0].includes('no recorded equivalent'));
ok(uncovered.length === 0, `rxjsSuggestions: all ${RXJS_SURFACE.length} RxJS names have an answer (uncovered: ${uncovered.join(', ') || 'none'})`);
// The array-method mappings must name the actual method, not hand-wave.
for (const [op, expect] of [['every', 'xs.every'], ['find', 'xs.find'], ['count', 'xs.length'], ['max', 'Math.max'], ['last', 'xs.at(-1)'], ['pluck', 'computed']]) {
  ok(cv.rxjsSuggestions([op])[0].includes(expect), `rxjsSuggestions: ${op} names its concrete equivalent (${expect})`);
}
// `pairwise` claims `watch` gives the previous value — that must be TRUE of the real runtime API, not wishful.
ok(/export function watch<T>\([\s\S]*?prev: T | undefined| undefined\| undefined/.test(readFileSync(join(repo, 'packages', 'runtime', 'src', 'extras.ts'), 'utf8')), 'the advice for pairwise is real: runtime `watch` really passes the previous value');
// Weave has `debounced` but NO throttle — the advice must not invent one.
ok(!cv.rxjsSuggestions(['throttleTime'])[0].includes('throttled('), 'rxjsSuggestions: throttleTime does NOT invent a `throttled()` API that Weave lacks');
ok(cv.convertService(rootSvc, []).ts.includes('could not be translated') === false, 'convertService: no RxJS imports → no RxJS advice at all');
// Advice is owed for the names that SURVIVE the translation, not for the ones the file happened to import. A
// service whose chain was rewritten into array methods needs no guidance about `map` — the `map` in the draft is
// already `Array.prototype.map`, and advising on it reads as work still to do.
const timeSvc = {
  file: 'x/time.service.ts', className: 'TimeService', providedIn: 'root', methods: ['stream'], fields: [], signals: [], injects: [],
  members: [{ kind: 'method', name: 'stream', isPublic: true, params: 'src: Observable<number>', body: 'return src.pipe(debounceTime(300), map((x) => x));', initializer: '', isSignal: false }],
};
const timeDraft = cv.convertService(timeSvc, ['debounceTime', 'map']);
ok(timeDraft.ts.includes('debounced'), 'convertService: an operator that SURVIVED translation keeps its advice');
const plainSvc = {
  file: 'x/plain.service.ts', className: 'PlainService', providedIn: 'root', methods: ['ids'], fields: [], signals: [], injects: [],
  members: [{ kind: 'method', name: 'ids', isPublic: true, params: 'xs: string[]', body: 'return of(xs).pipe(map((v) => v.length));', initializer: '', isSignal: false }],
};
const plainDraft = cv.convertService(plainSvc, ['of', 'map']);
ok(!plainDraft.ts.includes('could not be translated'), 'convertService: a chain that WAS translated gets no leftover RxJS advice');
ok(!/from 'rxjs/.test(plainDraft.ts), 'convertService: a fully translated service imports nothing from rxjs');
ok(plainDraft.ts.includes('return xs.length;'), 'convertService: `of(xs).pipe(map(f))` is the application `f(xs)`, not a stream');

/* ──────────── RxJS → Weave: the translation itself ──────────── */
// Weave has no stream primitive, so an app that finishes a migration still importing rxjs has been MOVED, not
// migrated. Every check below is on the rewrite, not on the advice beside it.

// The source classification is what the whole fold rests on: `of(a)` is ONE emission and `of(a, b)` is two, so
// they land on different shapes. Getting that wrong silently flattens a level.
ok(rx.classifySource('of(x)', []).shape === 'value', 'classifySource: `of(x)` is one emission — a value');
ok(rx.classifySource('of(a, b)', []).shape === 'array' && rx.classifySource('of(a, b)', []).code === '[a, b]', 'classifySource: `of(a, b)` is two emissions — an array');
ok(rx.classifySource('concat(of(ids), of([]))', []).code === '[ids, []]', 'classifySource: `concat` of two single-value sources is the two values, NOT their contents spread');
ok(rx.classifySource('EMPTY', []).code === '[]', 'classifySource: EMPTY completed without emitting — the empty array');
ok(rx.classifySource('forkJoin([a, b])', []).code === 'Promise.all([a, b])', 'classifySource: forkJoin over an array is Promise.all');
ok(rx.classifySource('this.http.get(url)', []).shape === 'unknown', 'classifySource: an unrecognised source is `unknown`, never assumed');

// The operators, folded over the shape they are being applied to.
const fold = (src) => rx.rxToWeave(src).code.trim();
ok(fold('const y = of(1, 2, 3).pipe(map((n) => n * 2));') === 'const y = [1, 2, 3].map((n) => n * 2);', 'fold: `map` over a sequence is Array.prototype.map');
ok(fold('const y = of(v).pipe(map((n) => n * 2));') === 'const y = v * 2;', 'fold: `map` over a single value is application, not a `.map` — and a one-use projection is inlined rather than left as an IIFE');
ok(fold('const y = concat(of(a), of(b)).pipe(mergeMap((xs) => xs), toArray());') === 'const y = [a, b].flatMap((xs) => xs);', 'fold: mergeMap is flatMap, and toArray over a sequence is nothing at all');
ok(fold('const y = of(1, 2).pipe(distinct());') === 'const y = [...new Set([1, 2])];', 'fold: distinct is a Set');
ok(fold('const y = of(1, 2).pipe(first());') === 'const y = [1, 2][0];', 'fold: first over a sequence is its first element');
ok(fold('const y = of(1).pipe(shareReplay(1));') === 'const y = 1;', 'fold: shareReplay folds to NOTHING — a computed value is already shared');
ok(fold('const y = of(1, 2).pipe(reduce((a, b) => a + b, 0));') === 'const y = [1, 2].reduce((a, b) => a + b, 0);', 'fold: reduce is Array.prototype.reduce');
ok(fold('const y = forkJoin([a, b]).pipe(map(([x, z]) => x + z));') === 'const y = Promise.all([a, b]).then(([x, z]) => x + z);', 'fold: map over a promise is .then');

// All-or-nothing. A chain rewritten up to the operator that stopped it would read as finished code that quietly
// drops the rest of the pipeline — so an untranslatable operator leaves the WHOLE chain standing.
const stopped = rx.rxToWeave('const y = of(1).pipe(map((n) => n), debounceTime(300), map((n) => n));');
ok(stopped.code.includes('debounceTime(300)') && stopped.code.includes('.pipe('), 'fold: an operator with no equivalent leaves the WHOLE chain intact — never half-rewritten');
ok(stopped.code.includes('of(1)'), 'fold: a stopped chain keeps its SOURCE too — collapsing `of` under a surviving `.pipe` would break it');
ok(stopped.todos.some((t) => t.includes('debounceTime')), 'fold: the operator that stopped the chain is NAMED');

// `.subscribe` is decided by the shape: once per emission is forEach, once for a value is a plain call.
ok(fold('of(1, 2).pipe(map((n) => n)).subscribe((n) => log(n));') === '[1, 2].map((n) => n).forEach((n) => log(n));', 'subscribe: over a sequence it is forEach');
ok(fold('of(v).subscribe((n) => log(n));') === 'log(v);', 'subscribe: on a single value it is the callback called once, with no pipe in between');

// Subjects. A BehaviorSubject IS a signal — current value, shared readers, notify on write.
const subj = rx.rxToWeave("class X {\n  private open = new BehaviorSubject<boolean>(false);\n  toggle() { this.open.next(!this.open.value); this.open.complete(); }\n}");
ok(subj.code.includes('signal<boolean>(false)'), 'subjects: BehaviorSubject is a signal, with its initial value kept');
ok(subj.code.includes('this.open.set(!this.open())'), 'subjects: `.next(v)` is a write and `.value` is a read');
ok(!subj.code.includes('complete()'), 'subjects: `.complete()` is dropped — teardown is the owner scope\'s job');
const bare = rx.rxToWeave('const ping = new Subject<string>();');
ok(bare.code.includes('signal<string | undefined>(undefined)'), 'subjects: a bare Subject has no current value, so the signal starts undefined');
ok(bare.todos.some((t) => t.includes('fan-out')), 'subjects: the one thing a Subject had and a signal does not is SAID, not hidden');

// The signature follows the body — and only ever follows it.
ok(rx.rxToWeave('function f(v: T): Observable<T> {\n  return of(v);\n}').code.includes('function f(v: T): T {'), 'types: a body that became synchronous gets a synchronous return type');
ok(rx.rxToWeave('function f(u: string): Observable<R> {\n  return from(fetch(u)).pipe(map((r) => r.json()));\n}').code.includes(': Promise<R>'), 'types: a body that became a promise gets Promise<T>');
const untranslated = rx.rxToWeave('function f(s: S): Observable<T> {\n  return s.pipe(debounceTime(9));\n}');
ok(untranslated.code.includes(': Observable<T>'), 'types: a body that was NOT translated KEEPS its Observable — the signature must not lie about the code under it');
ok(rx.rxToWeave('const c: Observable<number> = x;').code.includes(': number'), 'types: a plain annotation with no body is still rewritten');

// `firstValueFrom` was the escape hatch out of the stream world; the enclosing function has to become async.
const awaited = rx.rxToWeave('function load(u: string): Observable<T> {\n  const c = firstValueFrom(http.get(u));\n  return c;\n}');
ok(awaited.code.includes('await http.get(u)'), 'firstValueFrom: it is just an await');
ok(awaited.code.includes('async function load'), 'firstValueFrom: the function that gained an await is marked async');
ok(rx.asyncifyAwaiters('function g(): void {\n  return 1;\n}') === 'function g(): void {\n  return 1;\n}', 'asyncify: a function WITHOUT an await is left alone');
ok(rx.asyncifyAwaiters('const h = (): void => {\n  await x;\n}').includes('const h = async ():'), 'asyncify: an arrow that gained an await is marked async too');

// Import pruning, per BINDING. One surviving name used to keep the whole line — and with it a dependency on a
// package the app no longer calls.
const pr = rx.pruneRxImports(["import { Observable, of, map } from 'rxjs';"], 'const t: Observable<number> = q;');
ok(pr.lines.length === 1 && pr.lines[0] === "import { Observable } from 'rxjs';", 'pruneRxImports: only the surviving binding is kept, not the whole line');
ok(rx.pruneRxImports(["import { of } from 'rxjs';"], 'const x = 1;').lines.length === 0, 'pruneRxImports: a line with nothing live left is dropped');
ok(rx.pruneRxImports(["import { of } from 'rxjs';"], 'const x = 1; // of(2)').lines.length === 0, 'pruneRxImports: a TRAILING comment is not a use — the original carried beside a rewrite must not hold its import alive');
// If the `//` in a URL were taken for a comment marker, everything after it — including this `of` — would be
// stripped and the import dropped as dead. It is kept, which is the proof.
ok(rx.pruneRxImports(["import { of } from 'rxjs';"], "const u = 'http://x/of(1)';").lines.length === 1, 'pruneRxImports: a `//` inside a URL is not a comment marker');
ok(rx.pruneRxImports(["import { signal } from '@weave-framework/runtime';"], 'const x = 1;').lines.length === 1, 'pruneRxImports: a NON-rxjs import is never touched');
ok(rx.survivingRxNames("import { of } from 'rxjs';\nconst x = 1;", ['of']).length === 0, 'survivingRxNames: an import is not a use — otherwise every name looks live and nothing is ever pruned');

// The receiver walk. It must stop at the keyword: swallowing `return` handed the fold a source it could not
// classify, and every chain inside a `return` statement survived untranslated.
ok(rx.receiverStart('return concat(a, b)', 'return concat(a, b)'.length) === 'return '.length, 'receiverStart: the walk stops at the keyword before the expression');
ok(rx.receiverStart('x = this.http.get<T>(u)', 'x = this.http.get<T>(u)'.length) === 'x = '.length, 'receiverStart: a property chain with a generic call walks back whole');

/* ── the map the fold needs BEFORE it starts: what the unit declares as returning a stream ── */
// Real chains do not start at an `of(…)`; they start at a call. Without this the fold gave up on the first
// operator of almost every real file, which is what "the translator does nothing on my code" looks like.
const RET_SRC = `
export class R {
  resolve(route: X): Observable<C[]> { return of([]); }
  private _resolveCrumbs(route: X): Observable<C[]> { return of([]); }
  plain(x: number): number { return x; }
}
export function wrapIntoObservable<T>(value: T): Observable<T> { return of(value); }
const other = inject(Thing);
const anon = function (x: number): Observable<number> { return of(x); };
`;
const returners = rx.observableReturners([RET_SRC]);
ok(returners.has('_resolveCrumbs') && returners.has('resolve') && returners.has('wrapIntoObservable'), 'observableReturners: every declaration returning an Observable is found, methods and functions alike');
ok(!returners.has('plain'), 'observableReturners: a declaration returning something else is not one');
ok(!returners.has('function'), 'observableReturners: a keyword where the name would be is not a name');
ok(!returners.has('inject') && !returners.has('R'), 'observableReturners: the scan does not pair an identifier with a `): Observable<` several declarations later — a lazy regex crossed the whole file and collected exactly this noise');

// With the map, a chain whose source is a local call folds; without it, it does not.
const CHAIN = 'const y = this._resolveCrumbs(r).pipe(mergeMap((x: C[]) => x), distinct((x: C) => x.text), toArray());';
ok(rx.rxToWeave(CHAIN, [], returners).code.includes('new Set') === false && rx.rxToWeave(CHAIN, [], returners).code.includes('new Map('), 'returners: a chain starting at a local call FOLDS — this is the shape real code has');
ok(rx.rxToWeave(CHAIN, [], returners).code.includes('__v.text'), 'returners: the key projection is inlined correctly — `x.text` over `__v` is `__v.text`, never `__v.te__vt`');
ok(rx.rxToWeave(CHAIN).code.includes('.pipe('), 'returners: WITHOUT the map the same chain is left alone — the fold never guesses at a source it cannot classify');

// `toArray` collects a sequence into ONE emission. Conflating the two made everything after it fold as if there
// were still N emissions, so a `.subscribe` ran per item instead of once with the collected array.
ok(rx.rxToWeave('of(1, 2).pipe(toArray()).subscribe((xs) => take(xs));').code.trim() === 'take([1, 2]);', 'toArray: it collects into one emission, so the subscription runs ONCE with the array');

// An identity projection over a single emission is the canonical flatten; anything else maps that emission.
ok(rx.rxToWeave('const y = src.pipe(mergeMap((x) => x), take(2));', [], new Set(['src'])).code.includes('.slice(0, 2)') === false, 'flatten: a source that is not a call is still not classified by name alone');
const idFold = rx.rxToWeave('const y = load().pipe(mergeMap((x) => x), take(2));', [], new Set(['load']));
ok(idFold.code.includes('load().slice(0, 2)'), 'flatten: `mergeMap((x) => x)` over one emission is the flatten it was written as, so the sequence continues');

// A bare `concat` — nothing after it — is the collection its consumer reads, so the parts are spread.
ok(rx.rxToWeave('crumbs = concat(crumbs, load(x));', [], new Set(['load'])).code.trim() === 'crumbs = [...crumbs, ...load(x)];', 'concat: with no operators after it, the parts are SPREAD — the consumer reads one collection');
ok(rx.rxToWeave('const y = concat(of(a), of(b)).pipe(mergeMap((x) => x));').code.includes('[a, b].flatMap'), 'concat: as a pipe SOURCE it is still the sequence `[a, b]` — there the operators define the reading');

// `instanceof Observable` is the CLASS, so no signature rewrite reaches it — and it was the last thing keeping
// `rxjs` imported by files whose every chain had already folded.
const inst = rx.rxToWeave('if (value instanceof Observable) { return value; }');
ok(inst.code.includes('if (false)'), 'instanceof: nothing in a Weave app is an Observable, so the test is `false` and the branch is dead');
ok(inst.todos.some((t) => t.includes('dead')), 'instanceof: the dead branch is reported, not silently flipped');

// A union member that the rewrite turns into one already present is noise that reads like a mistake.
ok(rx.rxToWeave('function f<T>(v: T | Promise<T> | Observable<T>): Observable<T> { return of(v); }').code.includes('(v: T | Promise<T>)'), 'types: a union member rewritten into one already there is dropped, not duplicated');
// A body that returns BOTH a promise and a plain value must not be typed as only one of them.
ok(rx.rxToWeave('function f<T>(v: T): Observable<T> { if (p(v)) { return from(v); } return v as T; }').code.includes(': T | Promise<T>'), 'types: a body that returns a promise on one branch and a value on another says so');
ok(rx.rxToWeave('const y = from(Promise.resolve(v));').code.trim() === 'const y = Promise.resolve(v);', 'from: an argument that is already a promise is not wrapped a second time');

// An APOSTROPHE in prose opened a string literal that never closed, and every declaration after it was invisible
// to the scanners — so a comment reading `Router's calls were rewritten` silently switched the translation off
// for the rest of the file. The migration writes such comments itself; so does everybody's source.
const APOSTROPHE = [
  "  // Router's CALLS were rewritten, so this is a note and nothing more.",
  '  const lengths = (xs: string[]): Observable<number[]> => {',
  '    return xs.map((s) => s.length);',
  '  };',
].join(NL);
ok(!rx.rewriteObservableTypes(APOSTROPHE, []).includes('Observable'), "scanners: an apostrophe in a `//` comment does not open a string literal that swallows the rest of the file");
const APOSTROPHE_CHAIN = ["  // it's a note", '  const y = of(v).pipe(map((n) => n + 1));'].join(NL);
ok(!rx.rxToWeave(APOSTROPHE_CHAIN).code.includes('.pipe('), 'scanners: the chain after such a comment is still found and folded');
ok(rx.rxToWeave(["  /* it's a block note */", '  const y = of(v).pipe(map((n) => n + 1));'].join(NL)).code.includes('.pipe(') === false, 'scanners: a block comment counts too');

/* ── what the target app must actually be able to resolve ── */
// A type reached through a workspace alias was MIGRATED into the output and then still imported from the alias,
// which the target app does not have. The file was right there; only decorated classes were in the table.
const aliasDir = mkdtempSync(join(tmpdir(), 'weave-alias-'));
try {
  mkdirSync(join(aliasDir, 'src'), { recursive: true });
  writeFileSync(join(aliasDir, 'src', 'index.ts'), ["export * from './models';", "export * from './use';"].join(NL));
  writeFileSync(join(aliasDir, 'src', 'models.ts'), 'export interface IBreadcrumb { text: string }');
  writeFileSync(join(aliasDir, 'src', 'use.ts'), ["import { IBreadcrumb } from '@sps-interfaces';", 'export const first = (xs: IBreadcrumb[]): IBreadcrumb => xs[0];'].join(NL));
  const aliasFacts = a.assembleFacts(aliasDir);
  const table = cv.symbolTable(aliasFacts, join(aliasDir, 'out'));
  ok(table.has('IBreadcrumb'), 'symbolTable: a CARRIED file exports are in the table — only decorated classes used to be');
  const written = cv.planWrites(aliasFacts, join(aliasDir, 'out'));
  const useOut = written.find((w) => /use\.ts$/.test(w.path));
  ok(!!useOut && !/@sps-interfaces/.test(useOut.content), 'planWrites: an alias import is repointed at the migrated copy, not left naming a path the target app does not have');
  ok(!!useOut && /from '\.\/models'/.test(useOut.content), 'planWrites: it is repointed at the file the symbol actually landed in');
} finally {
  rmSync(aliasDir, { recursive: true, force: true });
}

/* ── the draft must not name bindings that are not there ── */
ok(cv.dropSelfDeclarations(['const r: Router = r;', 'const keep = 1;'].join(NL)) === 'const keep = 1;', 'dropSelfDeclarations: `const x: T = x;` is a binding declared from itself — dead, and a shadow of the real one');
ok(cv.dropSelfDeclarations(['const r: Router = r;', 'const keep = 1;'].join(String.fromCharCode(13) + NL)).includes('const r') === false, 'dropSelfDeclarations: it fires on CRLF too — an anchored `$` after `[\t ]*` never matched on a real Windows source');
ok(cv.dropSelfDeclarations('const r = other;') === 'const r = other;', 'dropSelfDeclarations: a real initializer is left alone');
// The placeholder used to name the Angular type — which the converted file no longer imports.
const ngCtx = { inputs: new Set(), fields: new Set(), getters: new Set(), methods: new Set(), injected: new Map(), signals: new Set() };
ok(cv.placeholderFor('Router', ngCtx) === 'null as any', 'placeholderFor: an Angular type is not named — @angular imports are dropped, so the name would resolve to nothing');
ok(cv.placeholderFor('MyOwnService', ngCtx) === 'null as unknown as MyOwnService', 'placeholderFor: a type the app really has is still named');
// A field whose CALLS were rewritten still has to exist when something reads the field itself.
const routerMembers = [
  { kind: 'field', name: '_router', isPublic: false, params: '', body: '', initializer: 'inject(Router)', isSignal: false, type: 'Router' },
  { kind: 'method', name: 'go', isPublic: true, params: '', body: "this._router.navigate(['/x']);", initializer: '', isSignal: false },
];
ok(cv.readsBareInjected(routerMembers, '_router', 'Router') === false, 'readsBareInjected: a field only ever CALLED through is not read directly');
const readMembers = [...routerMembers, { kind: 'method', name: 'peek', isPublic: true, params: '', body: 'const s = this._router.routerState.snapshot;', initializer: '', isSignal: false }];
ok(cv.readsBareInjected(readMembers, '_router', 'Router') === true, 'readsBareInjected: a PROPERTY read needs the field to exist — dropping it left the draft naming nothing');

/* ── the packages the written code needs ── */
// Naming them and stopping there left the app importing modules nothing provides, so the first `weave check`
// after a migration was a wall of "cannot find module" with the real TODOs buried in it.
const depDir = mkdtempSync(join(tmpdir(), 'weave-deps-'));
const appDir = mkdtempSync(join(tmpdir(), 'weave-app-'));
try {
  mkdirSync(join(depDir, 'pkg'), { recursive: true });
  writeFileSync(join(depDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.21', rxjs: '~7.8.0' } }));
  writeFileSync(join(depDir, 'pkg', 'package.json'), JSON.stringify({ dependencies: { lodash: '^3.0.0', '@ngx-translate/core': '^15.0.0' } }));
  const vers = cv.dependencyVersions(join(depDir, 'pkg'));
  ok(vers.lodash === '^3.0.0', 'dependencyVersions: the NEAREST package.json wins');
  ok(vers.rxjs === '~7.8.0', 'dependencyVersions: a workspace-root dependency is inherited, not lost');

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ dependencies: { '@weave-framework/runtime': '^2.0.0' } }));
  const carriedItems = [
    { path: 'a.ts', status: 'write', content: ["import { template } from 'lodash';", "import { T } from '@ngx-translate/core';", "import { Router } from '@angular/router';", "import { signal } from '@weave-framework/runtime';", 'const x = template && T && Router && signal;'].join(NL) },
  ];
  const installs = cv.carriedInstalls(carriedItems, join(depDir, 'pkg'), appDir);
  const specs = installs.map((i) => i.spec).sort();
  ok(specs.includes('lodash@^3.0.0'), 'carriedInstalls: the package is pinned to the version the SOURCE app used, not to latest');
  ok(specs.includes('@ngx-translate/core@^15.0.0'), 'carriedInstalls: every carried third-party package is offered');
  ok(!specs.some((s) => s.startsWith('@angular/')), 'carriedInstalls: @angular is NEVER offered — installing it to make carried imports resolve is the migration undone');
  ok(!specs.some((s) => s.startsWith('@weave-framework/')), 'carriedInstalls: Weave packages are not duplicated here — they have their own line');
  ok(cv.carriedInstalls(carriedItems, join(depDir, 'pkg'), depDir).every((i) => i.name !== 'lodash'), 'carriedInstalls: a package the target app ALREADY has is not offered again');
  // A package the source never declared still has to be installable — by name, with no version.
  const bare = cv.carriedInstalls([{ path: 'b.ts', status: 'write', content: ["import x from 'some-lib';", 'const y = x;'].join(NL) }], appDir, appDir);
  ok(bare.length === 1 && bare[0].spec === 'some-lib', 'carriedInstalls: a package with no recorded version is offered by name alone');
} finally {
  rmSync(depDir, { recursive: true, force: true });
  rmSync(appDir, { recursive: true, force: true });
}
// Each manager adds with its own verb; running the wrong one rewrites node_modules behind the right one's back.
ok(cv.installCommand('pnpm', ['a@1']) === 'pnpm add a@1', 'installCommand: pnpm adds');
ok(cv.installCommand('npm', ['a@1']) === 'npm i a@1', 'installCommand: npm uses `i`, not `add`');
ok(cv.installCommand('yarn', ['a@1']) === 'yarn add a@1' && cv.installCommand('bun', ['a@1']) === 'bun add a@1', 'installCommand: yarn and bun add');
ok(cv.installVerb('npm') === 'i' && cv.installVerb('pnpm') === 'add', 'installVerb: the verb is per manager');

// A spec is NOT trusted input: the names come from `import` specifiers in the code being migrated. Passing an
// args array alongside `shell: true` concatenates them into a shell line unescaped (Node's DEP0190), so the
// grammar is the guard — anything outside it is refused rather than escaped.
ok(cv.checkSpecs(['lodash@^4.17.21', '@ngx-translate/core@^15.0.0', 'some-lib']).refused.length === 0, 'checkSpecs: real package specs pass');
for (const evil of ['lodash; rm -rf /', 'a && curl evil.sh', 'x`whoami`', "a'b", 'a b', 'a$(id)', 'a|b', 'a>out']) {
  ok(cv.checkSpecs([evil]).refused.length === 1, `checkSpecs: refuses a spec carrying a shell metacharacter (${evil})`);
}
// The PLAN, not the run: a gate for "this must not execute" must not be the thing that executes it.
ok(cv.installPlan('npm', ['lodash; rm -rf /']).command === null, 'installPlan: an install containing an unrecognised spec produces NO command at all');
ok(cv.installPlan('npm', ['lodash; rm -rf /']).refused[0] === 'lodash; rm -rf /', 'installPlan: the spec that stopped it is named');
ok(cv.installPlan('npm', ['ok-pkg', 'a b']).command === null, 'installPlan: ONE bad spec stops the whole install, it is not filtered out and run anyway');
ok(cv.installPlan('npm', []).command === null, 'installPlan: nothing to install is not a command');
ok(cv.installPlan('pnpm', ['lodash@^4'], true).command === 'pnpm add -D lodash@^4', 'installPlan: a clean install produces the command it would run');

// dependencies vs devDependencies. A package reached only through `import type` is erased by TypeScript, so it
// never reaches the bundle; one that IS called at runtime and lands in devDependencies vanishes under
// `npm ci --omit=dev` and the app breaks where nobody is looking.
ok(cv.erasesAtRuntime(true, '{ A }'), 'erasesAtRuntime: `import type { A } from` erases');
ok(cv.erasesAtRuntime(false, '{ type A, type B }'), 'erasesAtRuntime: a clause whose every binding is `type` erases');
ok(!cv.erasesAtRuntime(false, '{ type A, b }'), 'erasesAtRuntime: ONE value binding keeps the package at runtime');
ok(!cv.erasesAtRuntime(false, 'X'), 'erasesAtRuntime: a default binding is a real value');
ok(!cv.erasesAtRuntime(false, '* as ns'), 'erasesAtRuntime: a namespace binding is a real value');
const kindItems = [
  { path: 'k.ts', status: 'write', content: ["import type { IB } from '@org/interfaces';", "import { template } from 'lodash';", 'const x = template; const y: IB = x;'].join(NL) },
];
const kinds = cv.carriedPackageKinds(kindItems);
ok(kinds.get('@org/interfaces') === 'types', 'carriedPackageKinds: a type-only import is a devDependency');
ok(kinds.get('lodash') === 'runtime', 'carriedPackageKinds: a value import is a runtime dependency');
const bothItems = [
  { path: 'b1.ts', status: 'write', content: ["import type { T } from 'dual';", 'const a: T = 1;'].join(NL) },
  { path: 'b2.ts', status: 'write', content: ["import { fn } from 'dual';", 'fn();'].join(NL) },
];
ok(cv.carriedPackageKinds(bothItems).get('dual') === 'runtime', 'carriedPackageKinds: imported both ways is RUNTIME — one value import puts it in the bundle');
ok(cv.carriedPackageKinds([bothItems[1], bothItems[0]]).get('dual') === 'runtime', 'carriedPackageKinds: still RUNTIME when the type-only file comes LAST — whichever file is read last must not decide it');
ok(cv.carriedPackages(kindItems).join(',') === '@org/interfaces,lodash', 'carriedPackages: still reports both, sorted');
// The flag is per manager, and the two kinds are two commands because they land in two places.
ok(cv.installCommand('pnpm', ['a'], true) === 'pnpm add -D a', 'installCommand: a devDependency carries the dev flag');
ok(cv.installCommand('npm', ['a'], true) === 'npm i -D a', 'installCommand: npm too');
ok(cv.devFlag('bun') === '-d' && cv.devFlag('yarn') === '-D', 'devFlag: bun spells it -d, the rest -D');
const lines = m.installLines('pnpm', [{ spec: 'lodash@^4', dev: false }, { spec: '@org/interfaces@^1', dev: true }]);
ok(lines.length === 2 && lines[0] === 'pnpm add lodash@^4' && lines[1] === 'pnpm add -D @org/interfaces@^1', 'installLines: runtime and type-only are SEPARATE commands — one list would put one of them in the wrong place');
ok(m.installLines('pnpm', [{ spec: 'a', dev: false }]).length === 1, 'installLines: no dev command when there is nothing for it');

// The same all-or-nothing rule for the sources that are not calls: `EMPTY` under a refused `.pipe` must stay
// `EMPTY`, or the chain becomes `[].pipe(…)` — no longer RxJS, and no longer valid either.
ok(rx.rxToWeave('const y = EMPTY.pipe(debounceTime(9));').code.includes('EMPTY.pipe('), 'fold: EMPTY is not collapsed under a `.pipe` the fold refused');
ok(rx.rxToWeave('const y = EMPTY.pipe(toArray());').code.trim() === 'const y = [];', 'fold: EMPTY IS collapsed when the chain folds');
// De-duplication has to actually de-duplicate — the operator's whole reason to exist.
ok(rx.rxToWeave('const y = of(1, 1, 2).pipe(distinct());').code.includes('new Set('), 'fold: distinct really de-duplicates');

/* ── the translation reaching the CONVERTED output, not just the module in isolation ── */
// A service holding all three cases at once: a Subject, a chain that folds, and a chain that does not.
const streamsFile = join(fx, 'services', 'streams.service.ts');
const streamsSvc = a.findServices(streamsFile)[0];
ok(!!streamsSvc, 'findServices: the streams fixture is picked up as a service');
const streamsTs = cv.convertService(streamsSvc, a.importedNamesFrom(streamsSvc.file, 'rxjs')).ts;
ok(streamsTs.includes('const open = signal<boolean>(false);'), 'convertService: a Subject FIELD becomes the signal itself, not a signal wrapping one');
ok(!/signal<\s*BehaviorSubject/.test(streamsTs), 'convertService: a Subject field is never typed as the class Weave does not have');
ok(streamsTs.includes('open.set(!open())'), 'convertService: a Subject is read and written as a signal — never `open()().set(v)`');
ok(streamsTs.includes('const lengths = (xs: string[]): number[] =>'), 'convertService: a translated method no longer says it returns an Observable');
ok(/settled[\s\S]{0,120}Observable<string>/.test(streamsTs), 'convertService: the method that could NOT be translated keeps its Observable — signature and body move together');
ok(streamsTs.includes("import { Observable } from 'rxjs';"), 'convertService: only the binding the surviving signature needs is imported');
ok(!/\bof\b|\bBehaviorSubject\b/.test(streamsTs.split('\n').filter((l) => l.startsWith('import')).join('\n')), 'convertService: the bindings the translation removed are NOT imported alongside it');
ok(streamsTs.includes('debounceTime'), 'convertService: the operator that stopped its chain is still named in the advice');
// The alias the source wrote for `this.` is dead once `this.` is gone, and it shadowed the real declaration.
ok(!/const _router: Router = _router;/.test(streamsTs), 'convertService: `const x: T = this.x` does not survive as `const x: T = x`');
// Its CALLS were rewritten, but `_router.url` reads the service itself — the field has to exist.
ok(/const _router = null as any;/.test(streamsTs), 'convertService: a field read directly is declared even when its calls were rewritten away');
ok(!/null as unknown as Router/.test(streamsTs), 'convertService: the placeholder does not name an Angular type the file no longer imports');

// The carried path — a helper module with no decorator is exactly where the streams hide.
const helperTs = cv.carryFile(join(fx, 'services', 'streams.helper.ts'), { packages: [], components: [], services: [], files: [] });
ok(!/from 'rxjs'/.test(helperTs), 'carryFile: a carried helper no longer imports rxjs');
ok(helperTs.includes('export function toStream<T>(v: T): T {'), 'carryFile: a carried signature follows its translated body');
ok(helperTs.includes('no longer depends on rxjs'), 'carryFile: the banner says what happened to the streams');
ok(cv.storeHookName('BreadcrumbsPathService') === 'useBreadcrumbsPath', 'storeHookName: Service suffix dropped, use-prefixed');

// ── M5.5: route guards → beforeEach. NOT one-to-one: an Angular guard is per-route, beforeEach is GLOBAL, so
//    each drafted guard checks the paths it used to protect — entry guards on nav.to, canDeactivate on nav.from.
const guardRoutes = [
  { path: 'admin', component: 'A', redirectTo: null, lazy: false, guards: ['AuthGuard'], guardsByKind: { canActivate: ['AuthGuard'] } },
  { path: 'edit', component: 'E', redirectTo: null, lazy: false, guards: ['DirtyGuard'], guardsByKind: { canDeactivate: ['DirtyGuard'] } },
];
const guardsTs = cv.convertGuards(guardRoutes);
ok(guardsTs.includes("import { beforeEach } from '@weave-framework/router';"), 'convertGuards: imports beforeEach from the router package');
ok(guardsTs.includes('nav.to.startsWith') && guardsTs.includes("'/admin'"), 'convertGuards: an entry guard (canActivate) checks nav.to against the paths it protected');
ok(guardsTs.includes('nav.from.startsWith') && guardsTs.includes("'/edit'"), 'convertGuards: a canDeactivate guard checks nav.from (leaving), not nav.to');
ok(guardsTs.includes('GLOBAL'), 'convertGuards: the draft states plainly that beforeEach is global, unlike a per-route Angular guard');
ok(guardsTs.includes('return () => off.forEach'), 'convertGuards: the unregister functions are returned for cleanup');
ok(cv.convertGuards([{ path: 'x', guards: [], guardsByKind: {} }]) === null, 'convertGuards: no guards → no module at all');

// ── THE rule: a migration MOVES code and adapts it; it never discards it. ──
// Every member is carried — public AND private, fields, methods, and the constructor. Before this, only PUBLIC
// members were even analysed, so a service whose real work lived in its constructor and a private helper came out
// as an empty shell and years of logic vanished with no trace that anything had been there.
const fullSvc = a.findServices(join(svcs, 'full.service.ts'))[0];
ok(fullSvc.members.some((mm) => mm.kind === 'constructor'), 'findServices: the constructor is captured');
ok(fullSvc.members.some((mm) => mm.name === 'hiddenHelper' && !mm.isPublic), 'findServices: a PRIVATE method is captured (it used to be invisible)');
ok(fullSvc.members.some((mm) => mm.kind === 'field' && mm.name === 'secret' && !mm.isPublic), 'findServices: a private field is captured');

const fullDraft = cv.convertService(fullSvc).ts;
ok(fullDraft.includes('hiddenHelper'), 'convertService: a private method is drafted too (as a local, not returned)');
ok(fullDraft.includes('not returned'), 'convertService: private members are marked as locals rather than surface');
ok(fullDraft.includes('original FullService constructor'), 'convertService: the constructor body is carried across');
ok(/return \{[^}]*visible[^}]*\}/.test(fullDraft) && !/return \{[^}]*hiddenHelper[^}]*\}/.test(fullDraft), 'convertService: only public members are returned; private ones stay local');

// The absolute check: EVERY non-empty line of the original class body must appear somewhere in the draft.
const lostLines = fullSvc.classBody
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && l !== '}' && l !== '{')
  .filter((l) => !fullDraft.includes(l));
ok(lostLines.length === 0, `NOTHING IS LOST: every line of the original class survives into the draft (lost: ${lostLines.slice(0, 3).join(' | ') || 'none'})`);

// The same guarantee for COMPONENTS, including the @Input fields that become props: they are migrated into the
// props type, so their original declaration would otherwise be the one thing with no trace left.
const cmpFacts = a.analyzeComponents([join(comps, 'decorator.component.ts')]);
const cmpDraft = cv.convertComponent(cmpFacts[0], '<p></p>', {}).ts;
const cmpLost = cmpFacts[0].classBody
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && l !== '}' && l !== '{')
  .filter((l) => !cmpDraft.includes(l));
ok(cmpLost.length === 0, `NOTHING IS LOST (component): every line survives, @Input fields included (lost: ${cmpLost.join(' | ') || 'none'})`);
ok(cmpDraft.includes('became props'), 'convertComponent: the fields that turned into props are shown, not silently absorbed');

// Angular lifecycle hooks are named, not left as anonymous methods.
ok(fullDraft.includes('lifecycle hook') && fullDraft.includes('onDispose'), 'convertService: ngOnDestroy is identified as a lifecycle hook with its Weave equivalent');

// Weave has NO interpolation inside an attribute value — its dynamic form is the WHOLE value or nothing. A mixed
// value passed through rendered the braces onto the element as literal text: visible in a browser, invisible to
// every string assertion, which is how it survived.
ok(cv.convertAttr({ name: 'class', value: 'logo-{{ svg.name }}-svg' }, 'div').out === 'class={{ "logo-" + (svg.name) + "-svg" }}', 'convertAttr: a MIXED attribute value becomes one expression, not text with braces in it');
ok(cv.convertAttr({ name: 'title', value: '{{ x }}' }, 'div').out === 'title={{ (x) }}', 'convertAttr: a wholly-interpolated attribute is the expression alone');
ok(cv.convertAttr({ name: 'class', value: 'plain' }, 'div').out === 'class="plain"', 'convertAttr: an attribute with no interpolation is left exactly as it was');
const mixedTpl = conv('<div class="a-{{ x | uppercase }}-b"></div>');
ok(!mixedTpl.includes('{{ x'), 'convertTemplate: nothing is left rendering `{{ … }}` as literal attribute text');
ok(compilesAsWeave(mixedTpl) === '', `the converted mixed attribute COMPILES${compilesAsWeave(mixedTpl) ? ` — ${compilesAsWeave(mixedTpl)}` : ''}`);

// The plan says `rxjs` is REPLACED by Weave's reactivity, and then the converted files import it anyway — a
// stream is not something to rewrite by guess. Both halves are defensible; saying only the first one is not, so
// the dependencies the migration hands your app are named.
const carriedPkgs = cv.carriedPackages([
  { path: 'a.ts', status: 'write', content: "import { Observable } from 'rxjs';\nimport { map } from 'rxjs/operators';\nimport x from '@weave-framework/ui/card';\nimport { y } from './local';\nconst o: Observable<number> = x;" },
  { path: 'b.html', status: 'write', content: "import { nope } from 'not-a-dep';" },
]);
ok(carriedPkgs.includes('rxjs'), 'carriedPackages: a third-party package the OUTPUT still imports is named');
ok(carriedPkgs.filter((p) => p === 'rxjs').length === 1, 'carriedPackages: `rxjs` and `rxjs/operators` are one dependency, not two');
ok(!carriedPkgs.some((p) => p.startsWith('@weave-framework')), 'carriedPackages: Weave packages are reported by the install line, not here');
ok(!carriedPkgs.includes('not-a-dep'), 'carriedPackages: a template is not TypeScript — its text is not scanned for imports');
ok(cv.carriedPackages([{ path: 'c.ts', status: 'write', content: "// import { old } from 'rxjs';" }]).length === 0, 'carriedPackages: the ORIGINAL carried as a comment beside a rewrite is not a dependency');

// ── a service THIS RUN converts is not "unknown" ──
// "`X.y()` has no recorded Weave equivalent — migrate X first" was printed for a class being migrated in the
// same run: work already happening, about a call already correct. And the field itself came out as a COMMENT,
// so every call through it named nothing.
const svcDir2 = join(fx, 'services');
const pairSvcs = ['crumbs.service.ts', 'crumbs-path.service.ts'].flatMap((n) => a.findServices(join(svcDir2, n)));
const migMap = cv.migratedServices(pairSvcs);
ok(migMap.get('CrumbsService')?.name === 'useCrumbs' && migMap.get('CrumbsService')?.kind === 'store', "migratedServices: a providedIn:'root' service is reached through its store hook");
const consumer = cv.convertService(pairSvcs[1], [], migMap).ts;
ok(!consumer.includes('no recorded Weave equivalent'), 'translateBody: a call into a service being migrated alongside is NOT reported as unknown');
ok(consumer.includes('const _CrumbsService = useCrumbs();'), 'draftMembers: the injected field becomes a real binding — a comment left every call through it undefined');
ok(consumer.includes("import { useCrumbs } from './crumbs.service';"), "carriedImportsFor: the import is repointed to what the converted file EXPORTS, not the class name it no longer has");
ok(consumer.includes('_CrumbsService.crumbsSig()'), 'translateBody: the call itself is unchanged — it was already right');
ok(!consumer.includes('this service injected CrumbsService'), 'convertService: a dependency reached three lines below is not also asked for');
// The constructor's body was the ONE body never translated.
const navSvc = a.findServices(join(svcDir2, 'nav.service.ts'))[0];
const navTs = cv.convertService(navSvc).ts;
ok(navTs.includes('onDispose(afterEach(() => {'), 'rewriteRouterEvents: a NavigationEnd subscription becomes afterEach, with onDispose for the takeUntilDestroyed');
ok(navTs.includes('loaded.set(true);') && navTs.includes('doChanges();'), "draftMembers: the CONSTRUCTOR body is translated like every other body — it was the only one that was not");
ok(navTs.includes("import { afterEach, navigate }") || navTs.includes("afterEach") && /from '@weave-framework\/router'/.test(navTs), 'serviceImportsFor: `Router.events` is a PROPERTY, so its imports need finding another way');
ok((navTs.match(/from '@weave-framework\/runtime'/g) ?? []).length === 1, 'mergeImportLines: one import line per module, however many pieces of the draft asked for something');
// The RxJS chain is gone, so its import is dead — and it names a package the target app has no reason to have.
ok(!navTs.includes("from 'rxjs/operators'"), 'pruneImports: an import the translation made dead is dropped, not carried into an app that does not depend on it');
ok(navTs.includes('filter((event)'), 'pruneImports: the original still travels as a comment — a name surviving only THERE is not a use');
ok(cv.pruneImports(["import { a } from 'x';"], 'const q = a;').length === 1, 'pruneImports: an import something actually uses is kept');
ok(cv.pruneImports(["import { a } from 'x';"], '// const q = a;').length === 0, 'pruneImports: a name only in a comment does not keep its import');
ok(cv.pruneImports(["import './side-effect.css';"], '').length === 1, 'pruneImports: a side-effect import is kept — it is there for what it DOES, not for a name');

// ── SECTIONS: a big unit is not migrated in one sitting ──
// A list of two hundred files is not a thing anyone reviews. The table spans the WHOLE unit either way, so
// section two knows what section one renamed — but what a chosen section NEEDS from one left behind has to be
// said, or the code lands not resolving and the reason was a decision made three prompts earlier.
const secRoot = join('t', 'src');
const secs = cv.sections([join(secRoot, 'app', 'a.ts'), join(secRoot, 'app', 'b.ts'), join(secRoot, 'shared', 'c.ts'), join(secRoot, 'main.ts')], secRoot);
ok(secs.length === 3, `sections: grouped by the top-level folder under src (got ${secs.map((s) => s.name).join(', ')})`);
ok(secs.find((s) => s.name === 'app')?.paths.length === 2, 'sections: every file lands in exactly one section');
ok(secs.some((s) => s.name === '(root)'), 'sections: a file directly under src is its own group, not silently dropped');
const secTable = new Map([['UserService', { from: 'UserService', to: 'useUser', isDefault: false, file: join(secRoot, 'shared', 'user.ts'), kind: 'service' }]]);
const chosen = [{ path: join(secRoot, 'app', 'a.ts'), content: "import { useUser } from '../shared/user';\nconst u = useUser();" }];
const dang = cv.danglingAcrossSections(chosen, secTable);
ok(dang.length === 1 && dang[0].needs === 'useUser', 'danglingAcrossSections: what a chosen file needs from a section left behind is named');
ok(cv.danglingAcrossSections([...chosen, { path: join(secRoot, 'shared', 'user.ts'), content: 'export const useUser = () => 1;' }], secTable).length === 0, 'danglingAcrossSections: once the section it needs is chosen too, there is nothing to say');

// ── VERIFY THE ASSEMBLED OUTPUT: does what we are about to write hold together? ──
// Every other check looks at one declaration at a time. This type-checks the planned files as ONE program, so a
// rename that landed in one file and not in its importer is a line on screen instead of something found later.
const vTarget = mkdtempSync(join(tmpdir(), 'weave-verify-'));
try {
  const good = [{ path: join(vTarget, 'src', 'a.ts'), status: 'write', content: 'export const a: number = 1;\n' },
                { path: join(vTarget, 'src', 'b.ts'), status: 'write', content: "import { a } from './a';\nexport const b: number = a + 1;\n" }];
  ok(vf.verifyOutput(good, vTarget).length === 0, 'verifyOutput: code that holds together reports nothing');
  // The disease itself: one file renamed, its importer not.
  const renamed = [{ path: join(vTarget, 'src', 'a.ts'), status: 'write', content: 'export const useA = (): number => 1;\n' },
                   { path: join(vTarget, 'src', 'b.ts'), status: 'write', content: "import { A } from './a';\nexport const b = A;\n" }];
  const found = vf.verifyOutput(renamed, vTarget);
  ok(found.some((p) => p.kind === 'defect' && /no exported member/.test(p.message)), 'verifyOutput: an import naming what the converted file no longer exports IS a defect — the exact cross-file failure per-file conversion cannot see');
  // A file already ON DISK, with an error of its own, that a planned file imports. The program must include it
  // — otherwise the import cannot be checked — but its errors are the app's, not this migration's.
  mkdirSync(join(vTarget, 'src'), { recursive: true });
  writeFileSync(join(vTarget, 'src', 'existing.ts'), 'export const bad: number = "not a number";\n');
  const mixed = vf.verifyOutput([{ path: join(vTarget, 'src', 'uses.ts'), status: 'write', content: "import { bad } from './existing';\nexport const q: string = bad;\n" }], vTarget);
  ok(mixed.some((p) => p.file.endsWith('uses.ts')), 'verifyOutput: the planned file\'s own error is reported');
  ok(mixed.every((p) => !p.file.endsWith('existing.ts')), "verifyOutput: an error in a file that was already there is the app's business, not this migration's");
  // A module the app lacks is an install, not a defect — the conversion is not wrong for naming what the source named.
  const dep = [{ path: join(vTarget, 'src', 'c.ts'), status: 'write', content: "import { x } from 'not-installed-anywhere';\nexport const c = x;\n" }];
  const depProbs = vf.verifyOutput(dep, vTarget);
  ok(depProbs.some((p) => p.kind === 'missing-dependency' && p.module === 'not-installed-anywhere'), 'verifyOutput: an uninstalled module is reported as a DEPENDENCY, not as broken code');
  ok(!depProbs.some((p) => p.kind === 'defect'), 'verifyOutput: and it is not ALSO counted as a defect — only one of the two is the tool\'s fault');
  // A file that is only planned, never written, must not be checked.
  ok(vf.verifyOutput([{ path: join(vTarget, 'src', 'd.ts'), status: 'skip-exists', content: 'this is not typescript at all' }], vTarget).length === 0, 'verifyOutput: a file that will NOT be written is not checked — it is not what the app gets');
} finally {
  rmSync(vTarget, { recursive: true, force: true });
}
// Two planned files on ONE path: applyWrites writes in order, so the second replaces the first and the
// migration reports both as written while one is not there.
ok(vf.collisions([{ path: 'x/a.ts' }, { path: 'x/a.ts' }, { path: 'x/b.ts' }]).length === 1, 'collisions: two sources landing on one path is an accounting error, found without a compiler');
ok(vf.collisions([{ path: 'x/a.ts' }, { path: 'x/b.ts' }]).length === 0, 'collisions: distinct paths are not a collision');

// ── ACCESS: what is USED but cannot be looked inside ──
// A method calls a method calls a method. Following every workspace lib turned ONE imported type into 214 files;
// following none migrates a service the app leans on as a name and nothing else. So each is asked for by name.
const shopFacts = a.assembleFacts(join(fx, 'nx-mono', 'apps', 'shop'));
const reach = a.outOfReach(shopFacts);

// ── route RESOLVERS → a route `loader` ──
// A resolver carries no decorator, so it fell through as "plain TypeScript, carried as-is": a file full of
// `ActivatedRouteSnapshot` moved unchanged, under a banner saying most of it already works. It does not work —
// nothing in Weave will ever call it.
const resFile = join(fx, 'routes', 'crumbs.resolver.ts');
const resolvers = a.findResolvers(resFile);
ok(resolvers.length === 1 && resolvers[0].className === 'CrumbsResolver', 'findResolvers: a class with a `resolve(route)` method is a route resolver, decorator or not');
ok(!resolvers.some((r) => r.className === 'PromiseLike'), "findResolvers: a no-argument `resolve()` is somebody else's method, not Angular's contract");
const resInv = a.inventory([resFile]);
ok(resInv.find((d) => d.name === 'CrumbsResolver')?.kind === 'resolver', 'inventory: a resolver is its own kind, not the `class` bucket');
ok(resInv.find((d) => d.name === 'CrumbsResolver')?.handled === true, 'coverage: and it counts as CONVERTED — it has a Weave counterpart, so calling it carried was over-reporting the gap');
const resTs = cv.convertResolver(resolvers[0]).ts;
ok(resTs.includes('export function loadCrumbs('), 'convertResolver: it becomes a loader function named after the resolver');
ok(resTs.includes('useLoaderData()') && resTs.includes('loader: loadCrumbs'), 'convertResolver: and says how to attach it and how the component reads it');
ok(resTs.includes('route.routeConfig.path'), 'convertResolver: the original body travels beside it — Angular hands a SNAPSHOT, a loader gets { params, query, signal }');
ok(resTs.includes('helper(): number'), 'convertResolver: the rest of the class is carried too');
// Recognising it is not enough — it has to reach the output, and NOT also be carried as a raw copy.
const resFacts = { unit: join(fx, 'routes'), entry: resFile, files: [resFile], angular: [], internal: [], packages: [], packageUsage: [], components: [], services: [], di: [], routes: [], forms: [], calls: [], branches: [], cycles: [], unresolved: [], ngModules: [], tokens: [], pipes: [], directives: [], resolvers, inventory: [], coverage: { total: 0, handled: 0, carried: 0, gaps: [], emptyFiles: [] } };
const resWrites = cv.planWrites(resFacts, join(tmpdir(), 'weave-resolver-out'));
ok(resWrites.some((w) => w.content.includes('export function loadCrumbs(')), 'planWrites: a recognised resolver actually produces its loader file');
ok(resWrites.filter((w) => w.path.endsWith('crumbs.resolver.ts')).length === 1, 'planWrites: and it is not ALSO carried as a raw copy — one source, one output');

// The banner on a CARRIED file must not claim it works when it still imports Angular.
const carriedAngular = cv.carryFile(resFile, { packages: [], components: [], services: [] });
ok(carriedAngular.includes('NOT CONVERTED') && carriedAngular.includes('does NOT work in Weave'), 'carryFile: a carried file that still imports @angular says so — "most of it already works" was false about the framework being left');
ok(!cv.carryFile(join(fx, 'routes', 'plain-helper.ts'), { packages: [], components: [], services: [] })?.includes('NOT CONVERTED'), 'carryFile: a file with no Angular imports keeps the plain banner');

// ── THE SYMBOL TABLE: one place that knows what everything became ──
// A component becomes a DEFAULT export while its importers went on naming the class; a service becomes
// `useX` while its importer asked for `XService`; a pipe becomes a function its consumer is told does not
// exist. Three patches, one problem — the mapping is built once, for the whole unit, and every emitted file is
// resolved against it in a single pass.
const symTarget = join(tmpdir(), 'weave-symbols-out');
const shopTable = cv.symbolTable(shopFacts, symTarget);
ok(shopTable.get('AppComponent')?.isDefault === true, 'symbolTable: a component is the DEFAULT export — exactly what its importers did not know');
ok(shopTable.get('UserService')?.to === 'useUser', 'symbolTable: a root service is reached through its store hook');
ok(shopTable.get('AppComponent')?.file.endsWith(`app${sep}app.ts`), 'symbolTable: it points at the file the WRITER actually writes — computing the path twice is how it came to point elsewhere');
const shopItems = cv.planWrites(shopFacts, symTarget);
const mainTs = shopItems.find((w) => w.path.endsWith(`src${sep}main.ts`))?.content ?? '';
ok(/import AppComponent from '\.\/app\/app';/.test(mainTs), 'resolveImports: a carried file importing a converted component gets a DEFAULT import at the right path');
ok(!/\{\s*AppComponent\s*\}/.test(mainTs), 'resolveImports: and no longer names it as a named export the file does not have');
// Only what the table KNOWS is touched.
ok(mainTs.includes("from '@angular/platform-browser'"), 'resolveImports: an import the table knows nothing about passes through exactly as written');
ok(cv.symbolCollisions(new Map([['A', { from: 'A', to: 'x', isDefault: false, file: 'f.ts', kind: 'pipe' }], ['B', { from: 'B', to: 'x', isDefault: false, file: 'f.ts', kind: 'pipe' }]])).length === 1, 'symbolCollisions: two source declarations landing on one exported name is named by SOURCE name, before anything is written');

// A drafted local must not SHADOW something the file imports. A field literally called `form` shadowed `form`
// from @weave-framework/forms, and the drafted `form({ … })` two lines later called the signal — reported as
// "Expected 0 arguments, but got 1", ten lines from the cause.
const shadowRenames = cv.localRenames([{ kind: 'field', name: 'form', isPublic: true, params: '', body: '', initializer: '', type: '', isSignal: false, text: '', decorators: [] }], ["import { field, form } from '@weave-framework/forms';"]);
ok(shadowRenames.get('form') === 'ownForm', 'localRenames: a member colliding with an import is renamed — the member is what moves, the import is what the file needs');
ok(cv.localRenames([{ kind: 'field', name: 'title', isPublic: true, params: '', body: '', initializer: '', type: '', isSignal: false, text: '', decorators: [] }], []).size === 0, 'localRenames: a name that collides with nothing is left alone');
ok(cv.localRenames([{ kind: 'field', name: 'props', isPublic: true, params: '', body: '', initializer: '', type: '', isSignal: false, text: '', decorators: [] }], []).get('props') === 'ownProps', 'localRenames: a draft\'s OWN generated names count too — `props` is not importable but is very much taken');
// The shadow, end to end: the login fixture's field is literally called `form`.
const loginTs2 = shopItems.find((w) => w.path.endsWith(`app${sep}login.ts`))?.content ?? '';
ok(loginTs2.includes('const ownForm ='), 'convertComponent: the colliding member is renamed in the OUTPUT, not just in a map');
ok(loginTs2.includes("import { field, form } from '@weave-framework/forms';"), 'convertComponent: and the import it collided with is untouched, so the drafted form({ … }) still means the form');
// A value built from Angular classes cannot be carried as live code: `@angular/*` imports do not come across.
ok(!/=\s*signal\([^)]*new FormGroup/.test(loginTs2), 'signalDecl: `new FormGroup(…)` is NOT emitted as a live value — the class is not there to construct');
ok(/const ownForm = signal<[^>]*\| undefined>\(undefined\);/.test(loginTs2), 'signalDecl: the declaration and its type survive; only the value it cannot build is dropped');
ok(loginTs2.includes('which is Angular') && loginTs2.includes('give it its Weave value here'), 'signalDecl: and it says which Angular names it could not bring across');
// A constructor PARAMETER-PROPERTY is not a class member, so the field branch never sees it.
const userSvc2 = shopItems.find((w) => w.path.endsWith('user.service.ts'))?.content ?? '';
ok(userSvc2.includes('const analytics = null as unknown as AnalyticsService;'), 'draftMembers: a dependency declared as a constructor parameter is DECLARED — a comment left every call through it naming nothing');
ok(userSvc2.includes('was not migrated, so nothing provides this'), 'draftMembers: and the hole says so — `null` throws the moment it is used, which is the truth');
ok(!/const router = null/.test(userSvc2), "draftMembers: a dependency whose calls WERE rewritten needs no such hole");
// A symbol that lives in the file being resolved needs no import at all — it is right there.
const selfSym = new Map([['Thing', { from: 'Thing', to: 'thing', isDefault: false, file: join('x', 'a.ts'), kind: 'pipe' }]]);
ok(!cv.resolveImports("import { Thing } from './a';\nexport const q = Thing;", join('x', 'a.ts'), selfSym).includes('import'), 'resolveImports: a symbol that landed in THIS file is not imported into itself');
ok(cv.resolveImports("import { Thing } from './a';\nexport const q = Thing;", join('x', 'b.ts'), selfSym).includes("import { thing as Thing } from './a';"), 'resolveImports: from another file it is imported under its new name, aliased so the use sites are untouched');

const lib = reach.find((r) => r.name === '@sps-interfaces');
ok(lib?.kind === 'lib', 'outOfReach: a workspace library reached through a tsconfig alias is an item to ask about');
ok(lib?.uses.includes('User'), 'outOfReach: it names what is actually USED from the lib — the reason to go in, and the stake');
ok(lib?.path?.includes('sps-interfaces'), 'outOfReach: the workspace already says where the lib lives, so the question is permission, not a path');
ok(lib?.neededBy.some((f) => f.endsWith('app.component.ts')), 'outOfReach: it names the files that need it');
const missingClass = reach.find((r) => r.name === 'AnalyticsService');
ok(missingClass?.kind === 'class' && missingClass.path === null, 'outOfReach: an injected class with no definition here is a gap, and only the user knows where it is');
ok(!reach.some((r) => r.name === 'Router'), "outOfReach: Angular's own injectables are NOT gaps — they have a recorded answer, and asking where Router lives is nonsense");

// GRANTING ACCESS IS NOT "TAKE THE WHOLE LIBRARY". A library's entry is a barrel of `export *`, so analysing one
// from its entry reaches every file in it — importing ONE interface migrated two hundred. What is wanted is what
// is USED, and the files that DECLARE those names are the roots to walk from.
const ifaceDir = join(fx, 'nx-mono', 'libs', 'sps-interfaces');
const whole = a.assembleFacts(ifaceDir);
const narrowed = a.assembleFacts(ifaceDir, ['User']);
ok(whole.files.length > 3, `the lib fixture really is a barrel over several files (got ${whole.files.length}) — otherwise narrowing cannot be tested`);
ok(narrowed.files.length < whole.files.length, `assembleFacts(only): a used name pulls in less than the whole library (${narrowed.files.length} vs ${whole.files.length})`);
ok(narrowed.files.every((f) => !/(order|invoice|address|payment|shipment)\.ts$/.test(f)), 'assembleFacts(only): the files nothing asked for are not migrated at all');
ok(narrowed.files.some((f) => f.endsWith(`user.ts`)), 'assembleFacts(only): the file DECLARING the wanted name is');
ok(a.exportedNames(join(ifaceDir, 'src', 'lib', 'user.ts')).includes('User'), 'exportedNames: a top-level exported interface is found');
// An unknown name means "I could not locate it here" — the honest answer is the whole unit, not an empty one.
ok(a.assembleFacts(ifaceDir, ['NoSuchType']).files.length === whole.files.length, 'assembleFacts(only): a name that is nowhere in the unit falls back to the whole unit, never to nothing');

// Granting access folds the unit in, and coverage is recomputed over the COMBINED source — keeping the old
// coverage would report a percentage of a smaller source than the one actually being migrated.
const uiFacts = a.assembleFacts(join(fx, 'nx-mono', 'libs', 'ui'));
const merged = a.mergeFacts(shopFacts, uiFacts);
ok(merged.files.length === new Set([...shopFacts.files, ...uiFacts.files]).size, 'mergeFacts: the file lists join, de-duplicated');
ok(uiFacts.coverage.total > 0, 'the lib fixture actually declares something — otherwise the merge gate below can never fail');
ok(merged.coverage.total === shopFacts.coverage.total + uiFacts.coverage.total, 'mergeFacts: coverage is recomputed over the combined inventory, not carried over');
ok(merged.granted?.includes(uiFacts.unit), 'mergeFacts: the unit that was opened up is recorded');
ok(a.mergeFacts(shopFacts, shopFacts).components.length === shopFacts.components.length, 'mergeFacts: merging a unit twice does not double-count it');
// A path may point at a file, at `src/`, or at the project folder — all three mean the same unit. Stopping at the
// parent folder made `libs/x/src/index.ts` a unit called `src`, whose output then landed in `src/src/`.
ok(m.unitRootFor(join(fx, 'nx-mono', 'libs', 'sps-interfaces', 'src', 'index.ts')).endsWith('sps-interfaces'), 'unitRootFor: a FILE climbs to the project it belongs to, never stopping at `src`');
ok(m.unitRootFor(join(fx, 'nx-mono', 'libs', 'ui', 'src')).endsWith(`libs${sep}ui`), 'unitRootFor: `src/` climbs to the project marked by its project.json');
ok(m.unitRootFor(join(fx, 'nx-mono', 'libs', 'ui')).endsWith(`libs${sep}ui`), 'unitRootFor: the project folder itself resolves to itself');
// ng-packagr puts a package.json inside `src/` for a secondary entry point — a project MARKER on a folder that
// is not a project. Without the guard the unit is called `src`, and its output lands in `src/src/`.
ok(m.unitRootFor(join(fx, 'nx-mono', 'libs', 'secondary', 'src', 'index.ts')).endsWith('secondary'), 'unitRootFor: a package.json inside `src/` does not make `src` a unit');

// A granted unit's files are NOT under the base unit, and mirroring them against it made
// `libs/x/src/index.ts` land on `src/index.ts` — two sources, one output, one of them silently lost.
const mergedWrites = cv.planWrites(merged, join(tmpdir(), 'weave-merge-out'));
const mergedPaths = mergedWrites.map((w) => w.path);
ok(mergedPaths.length === new Set(mergedPaths).size, `planWrites: a merged unit never writes two sources to one path (dupes: ${mergedPaths.filter((p, i) => mergedPaths.indexOf(p) !== i).join(', ') || 'none'})`);
ok(mergedWrites.some((w) => w.path.includes(`${sep}ui${sep}`)), "planWrites: a granted unit's output lands under its own folder, not merged into the app's tree");
ok(mergedWrites.every((w) => !w.path.includes('..')), 'planWrites: nothing escapes the target directory, however far outside the unit its source lived');
// `src/index.html` is a Weave app's HTML SHELL, and a `.ts` beside a `.html` IS a component. Carrying a library's
// barrel to `src/index.ts` turned the shell into a component template — `weave check` began reporting errors
// inside the `<!doctype html>`.
const barrelWrites = cv.planWrites(whole, join(tmpdir(), 'weave-barrel-out'));
ok(whole.files.some((f) => f.endsWith(`src${sep}index.ts`)), 'the lib fixture really has a root index.ts — otherwise the shell-collision gate cannot fail');
ok(!barrelWrites.some((w) => w.path.endsWith(`src${sep}index.ts`)), 'planWrites: nothing is written to src/index.ts — it would pair with the app shell and make it a component');
ok(barrelWrites.some((w) => w.path.endsWith('index.barrel.ts')), 'planWrites: the barrel is still carried, under a name that collides with nothing');

// The plan says which happened: "you chose not to show me this" is not the same answer as "it was not there".
const declinedPlan = pl.renderPlan({ ...shopFacts, declined: ['@sps-interfaces'], granted: ['/libs/ui'] });
ok(declinedPlan.includes('Left closed') && declinedPlan.includes('@sps-interfaces'), 'renderPlan: a declined unit is recorded as a CHOICE, not as a gap in the analysis');
ok(declinedPlan.includes('Opened up on request') && declinedPlan.includes('/libs/ui'), 'renderPlan: a granted unit is recorded too');

// ── pipes → functions, directives → use: actions, styles → the sibling stylesheet ──
const pipesDir = join(fx, 'pipes');
const pipe = a.findPipes(join(pipesDir, 'shorten.pipe.ts'))[0];
ok(pipe.pipeName === 'shorten' && pipe.pure === false, 'findPipes: the pipe name and its `pure` flag are read');
ok(pipe.transform.params.includes('max: number') && pipe.transform.body.includes('value.slice'), "findPipes: transform's signature and body are captured");
const pipeTs = cv.convertPipe(pipe).ts;
ok(pipeTs.includes('export function shorten(value: string, max: number = 10)'), 'convertPipe: the pipe becomes a plain function with transform\'s signature');
ok(pipeTs.includes('{{ shorten(x) }}'), 'convertPipe: it says how the template call changes');
ok(pipeTs.includes('pure: false') && pipeTs.includes('change-detection'), 'convertPipe: an impure pipe is flagged — Weave has no change-detection pass');
ok(pipeTs.includes('helper'), 'convertPipe: the rest of the class is carried too');

const dir = a.findDirectives(join(pipesDir, 'highlight.directive.ts'))[0];
ok(dir.selector === '[appHighlight]' && dir.inputs.includes('colour'), 'findDirectives: the selector and @Input are read');
const dirTs = cv.convertDirective(dir).ts;
ok(dirTs.includes('export function appHighlight(el: HTMLElement'), 'convertDirective: the directive becomes a use: action taking the element');
ok(dirTs.includes("const defaults = { colour: 'yellow' };") && dirTs.includes('const opts = signal({ ...defaults, ...arg });'), 'convertDirective: an @Input default is applied, and update() replaces the argument reactively');
ok(dirTs.includes('use:appHighlight'), 'convertDirective: it says how to apply the action in a template');
ok(dirTs.includes('onEnter'), 'convertDirective: the original members are carried');
// A directive IS host bindings and behaviour, and both used to be commented out wholesale.
ok(dirTs.includes('const active = signal<boolean>(false);'), 'convertDirective: its fields become signals holding what they held');
ok(dirTs.includes('const isActive = computed(() => active());'), 'convertDirective: a @HostBinding getter is translated, not stubbed');
ok(dirTs.includes("effect(() => { el.classList.toggle('is-active', Boolean(isActive())); });"), 'convertDirective: a host class binding becomes real work on the element it is handed');
ok(dirTs.includes("el.classList.add('app-highlight');"), 'convertDirective: a static host class is applied to the element');
// `setProperty` takes the name verbatim in Weave — Angular normalises it, so a camelCase name set NOTHING.
ok(dirTs.includes("el.style.setProperty('outline-width', String(outlineWidth()) + 'px');"), 'convertDirective: a camelCase style name is kebab-cased, and the unit kept');
ok(cv.cssProp('backgroundColor') === 'background-color', 'cssProp: camelCase becomes the CSS property name setProperty actually knows');
ok(cv.cssProp('--brand') === '--brand', 'cssProp: a custom property is already in the right form and is left alone');
ok(cv.convertAttr({ name: '[style.backgroundColor]', value: 'c' }, 'div').out === 'style:background-color={{ c }}', 'convertAttr: a template style binding is kebab-cased too — the same silent no-op');
ok(dirTs.includes("effect(() => { el.setAttribute('data-colour', String(opts().colour ?? '')); });"), "convertDirective: a `host: {}` binding reads the argument through a SIGNAL — a plain value would never re-run the effect when update() replaced it");
ok(dirTs.includes("el.addEventListener('mouseenter', handler0);"), 'convertDirective: a @HostListener becomes a real listener');
ok(dirTs.includes("el.removeEventListener('mouseenter', handler0);") && dirTs.includes('onDispose(destroy)'), 'convertDirective: every listener is removed on teardown — a named handler, because an inline arrow cannot be removed');
ok(dirTs.includes('el.style.background = opts().colour;'), 'convertDirective: `this.el.nativeElement` IS the element an action is handed — `.nativeElement` is gone');
const dirLost = dir.classBody.split('\n').map((l) => l.trim()).filter((l) => l && l !== '}' && l !== '{').filter((l) => !dirTs.includes(l));
ok(dirLost.length === 0, `NOTHING IS LOST (directive): every line survives (lost: ${dirLost.join(' | ') || 'none'})`);

// Styles: Weave pairs a component with a SIBLING stylesheet. Inline styles used to be COUNTED and dropped.
const styleFacts = { file: join(fx, 'components', 'decorator.component.ts'), className: 'DecoratorComponent', styleUrls: [], styleTexts: ['h1 { color: red }'] };
const styleOut = cv.componentStyles(styleFacts, 'decorator');
ok(styleOut.length === 1 && styleOut[0].name === 'decorator.css', 'componentStyles: inline styles are written to the sibling stylesheet');
ok(styleOut[0].content.includes('h1 { color: red }'), 'componentStyles: the inline CSS itself is carried, not just its count');
ok(cv.componentStyles({ file: 'x.ts', className: 'X', styleUrls: ['./missing.scss'], styleTexts: [] }, 'x').length === 0, 'componentStyles: an unreadable stylesheet yields nothing (never an invented empty file)');

// ── Angular Material → @weave-framework/ui. These tags used to pass through as dead markup: a converted app
//    rendered a literal <mat-card> that did nothing at all, silently.
const matHtml = '<mat-card><mat-form-field><input matInput [(ngModel)]="name"></mat-form-field><mat-checkbox [checked]="ok">Agree</mat-checkbox><button mat-raised-button (click)="go()" matTooltip="Send">Go</button></mat-card>';
const matOut = conv(matHtml);
ok(matOut.includes('<Card>') && !matOut.includes('<mat-card>'), 'convertTemplate: <mat-card> becomes <Card>, not dead markup');
ok(matOut.includes('<FormField>') && matOut.includes('<Input '), 'convertTemplate: <mat-form-field> and matInput map to their Weave UI components');
ok(matOut.includes('<Button ') && !matOut.includes('mat-raised-button'), 'convertTemplate: a Material ATTRIBUTE decides the tag, and the marker attribute itself disappears');
ok(matOut.includes('<Checkbox checked={{ ok }}>'), 'convertTemplate: a bound prop on a mapped component is a plain prop, not .prop');
// Things whose Weave equivalent is a FUNCTION must NOT be renamed into a tag or an attribute.
ok(matOut.includes('use:tooltip') && matOut.includes('TODO(weave migrate)'), 'convertTemplate: matTooltip is flagged as a use: action rather than invented as an attribute');
ok(conv('<mat-dialog></mat-dialog>').includes('openDialog'), 'convertTemplate: <mat-dialog> points at openDialog — a dialog is opened, not placed in markup');
// The components have to be imported to exist.
const uiImports = cv.uiImportsFor(matHtml);
ok(uiImports.includes("import Card from '@weave-framework/ui/card';") && uiImports.includes("import Input from '@weave-framework/ui/input';"), 'uiImportsFor: the needed Weave UI imports are derived from the template');
ok(cv.uiImportsFor('<div>plain</div>').length === 0, 'uiImportsFor: a template using no Material needs no UI imports');
ok(cv.convertComponent(loginFact, matHtml, {}).ts.includes("from '@weave-framework/ui/card'"), 'convertComponent: those imports land in the generated component file');

// The target app may not HAVE the packages the generated code imports — the scaffold ships no @weave-framework/ui.
const needs = cv.requiredWeavePackages([{ path: 'x.ts', content: "import Card from '@weave-framework/ui/card';\nimport { store } from '@weave-framework/store';", status: 'write' }]);
ok(needs.includes('@weave-framework/ui') && needs.includes('@weave-framework/store'), 'requiredWeavePackages: subpath imports collapse to the package that must be installed');
ok(cv.installedWeavePackages(join(fx, 'not-angular')).length === 0, 'installedWeavePackages: an app with no Weave deps reports none');

// The install line must follow THIS app's package manager. `pnpm i x` does not add a dependency the way
// `npm i x` does, and running npm inside a pnpm project rewrites node_modules behind pnpm's back.
const pmDir = mkdtempSync(join(tmpdir(), 'weave-pm-'));
try {
  writeFileSync(join(pmDir, 'package.json'), '{}');
  ok(cv.detectPackageManager(pmDir) === 'npm', 'detectPackageManager: nothing to go on → npm');
  writeFileSync(join(pmDir, 'pnpm-lock.yaml'), '');
  ok(cv.detectPackageManager(pmDir) === 'pnpm', 'detectPackageManager: a pnpm lockfile → pnpm');
  writeFileSync(join(pmDir, 'yarn.lock'), '');
  ok(cv.detectPackageManager(pmDir) === 'pnpm', 'detectPackageManager: pnpm wins over a stray yarn.lock (checked in order)');
  // An explicit `packageManager` field is a declaration of intent — it outranks any lockfile lying around.
  writeFileSync(join(pmDir, 'package.json'), '{"packageManager":"yarn@4.1.0"}');
  ok(cv.detectPackageManager(pmDir) === 'yarn', 'detectPackageManager: the packageManager field outranks the lockfiles');
} finally {
  rmSync(pmDir, { recursive: true, force: true });
}
ok(cv.installCommand('npm', ['@weave-framework/ui']) === 'npm i @weave-framework/ui', 'installCommand: npm uses `i`');
ok(cv.installCommand('pnpm', ['@weave-framework/ui']) === 'pnpm add @weave-framework/ui', 'installCommand: pnpm uses `add`, NOT `i`');
ok(cv.installCommand('yarn', ['a', 'b']) === 'yarn add a b', 'installCommand: yarn uses `add` and takes several packages');
ok(cv.installCommand('bun', ['a']) === 'bun add a', 'installCommand: bun uses `add`');

// ── HttpClient → @weave-framework/data: a real client line, plus guidance naming the verbs actually called ──
const httpSvc = a.findServices(join(svcs, 'http.service.ts'))[0];
ok(httpSvc.injects.includes('HttpClient'), 'findServices: the injected HttpClient is seen');
const httpTs = cv.convertService(httpSvc).ts;
ok(httpTs.includes("import { createClient } from '@weave-framework/data';"), 'convertService: an HttpClient service imports the data package');
ok(httpTs.includes("const client = createClient({ baseUrl: '/api' })"), 'convertService: a real client is created, not just described');
ok(!httpTs.includes('import { action') && !httpTs.includes('resource }'), 'convertService: resource/action are NOT imported — nothing generated uses them, and a dead import is not a courtesy');
ok(httpTs.includes('reads (get)') && httpTs.includes('resource('), 'convertService: the guidance names the READ verbs the class actually calls');
ok(httpTs.includes('writes (post, delete)') && httpTs.includes('action('), 'convertService: and the WRITE verbs, mapped to action()');
// Word boundaries matter here: a naive substring check for "put" matches "input" in `action(async (input) => …)`.
ok(!/\bput\b/.test(httpTs) && !/\bpatch\b/.test(httpTs), 'convertService: verbs the class never calls are not mentioned');
ok(httpTs.includes('no `.subscribe()`'), 'convertService: it states the Observable→Promise change plainly');
// a service with no HttpClient gets none of this
ok(!cv.convertService(rootSvc).ts.includes('@weave-framework/data'), 'convertService: a service without HttpClient gets no data-package section');

// ── NgModules → a wiring note (NOT code, and NOT counted as converted); InjectionToken → a context ──
const modFile = join(routesDir, 'module.routes.ts');
const mods = a.findNgModules(modFile);
ok(mods.length === 1 && mods[0].className === 'AppRoutingModule', 'findNgModules: the @NgModule class is found');
ok(mods[0].imports.some((i) => i.includes('RouterModule.forRoot')), 'findNgModules: a RouterModule.forRoot(...) import is recorded as such');

const modTs = cv.convertNgModule({ file: 'x.ts', className: 'AppModule', declarations: ['AppComponent'], imports: ['CommonModule'], exports: ['AppComponent'], providers: ['ConfigService'], bootstrap: ['AppComponent'] });
ok(modTs.includes('Weave has NO modules'), 'convertNgModule: it says plainly there is nothing to translate');
ok(modTs.includes('ConfigService') && modTs.includes('provide('), 'convertNgModule: each provider is named with what it becomes (provide/inject)');
ok(modTs.includes('declarations') && modTs.includes('AppComponent'), 'convertNgModule: the declarations are recorded — only the module knew them');
ok(modTs.includes('mount()'), 'convertNgModule: a bootstrap module points at the Weave mount call');
// An NgModule becomes no Weave code, so it must NOT be counted as converted.
const modInv = a.inventory([modFile]).find((d) => d.kind === 'ngmodule');
ok(modInv && !modInv.handled && modInv.note.includes('no code'), 'coverage: an @NgModule is NOT counted as converted — a note is not a conversion');

const tokFile = join(pipesDir, 'tokens.ts');
const toks = a.findTokens(tokFile);
ok(toks.length === 1 && toks[0].name === 'APP_CONFIG' && toks[0].description === 'app.config', 'findTokens: an InjectionToken const and its description are read');
const tokTs = cv.convertTokens(toks);
ok(tokTs.includes('createContext') && tokTs.includes('export const APP_CONFIG'), 'convertTokens: a token becomes a context');
ok(cv.convertTokens([]) === null, 'convertTokens: no tokens → no file at all');

// ── COVERAGE: the tool must measure itself against the SOURCE, not against its own feature list. ──
// Every gap so far was found by a person asking "are we done?", never by the tool admitting it. These checks
// make silence impossible: anything the converter does not emit has to show up as a counted, explained gap.
const inv = a.inventory([join(comps, 'decorator.component.ts'), join(svcs, 'api.service.ts'), join(fx, 'forms', 'grouped.ts')]);
ok(inv.some((d) => d.kind === 'component' && d.handled), 'inventory: a @Component is listed as handled');
ok(inv.some((d) => d.kind === 'service' && d.handled), 'inventory: an @Injectable is listed as handled');
ok(inv.some((d) => d.kind === 'const' && !d.handled), 'inventory: a plain const is listed as NOT handled (it used to be invisible)');
ok(inv.filter((d) => !d.handled).every((d) => d.note.trim().length > 0), 'inventory: every unhandled declaration says WHY — silence is what hid these gaps');

const cov = a.coverage(inv);
ok(cov.total === inv.length && cov.handled < cov.total, `coverage: reports a real fraction, not 100% (got ${cov.handled}/${cov.total})`);
ok(cov.gaps.length > 0 && cov.gaps.every((g) => g.count > 0 && g.names.length > 0), 'coverage: each gap is counted AND names the declarations');
// `emptyFiles` names files nothing is produced from. `inventory()` alone cannot know what the writer emits, so
// here it flags them; the end-to-end check further down asserts the real pipeline leaves that list empty.
ok(Array.isArray(cov.emptyFiles), 'coverage: reports which files contribute nothing, by name');

// The anti-lie check: anything marked `handled` must actually produce a written file. A kind can only be added
// to HANDLED_KINDS once the writer really emits for it — otherwise coverage would over-report.
const covFacts = a.assembleFacts(shop);
const writtenFiles = new Set(cv.planWrites(covFacts, '/tmp/cov').map((w) => w.path));
const handledDecls = covFacts.inventory.filter((d) => d.handled);
ok(handledDecls.length > 0 && writtenFiles.size > 0, 'coverage: the fixture has handled declarations and produced writes');
const claimedButUnwritten = handledDecls.filter((d) => ![...writtenFiles].some((w) => w.includes(d.file.split(/[\\/]/).pop().replace(/\.component\.ts$|\.service\.ts$|\.ts$/, ''))));
ok(claimedButUnwritten.length === 0, `coverage does not LIE: every declaration marked handled really produces output (claimed-but-unwritten: ${claimedButUnwritten.map((d) => d.name).join(', ') || 'none'})`);

// ── EVERY walked file must reach the output, and no two may fight over the same path. ──
// A file with no @Component/@Injectable used to produce nothing at all: on a real library that was half of them,
// including the index.ts consumers import. And service paths were derived from the CLASS name while component
// paths came from the FILE, so `breadcrumbs.component.ts` and `BreadcrumbsService` both wrote `breadcrumbs.ts`
// and the second silently overwrote the first.
const covWrites = cv.planWrites(covFacts, '/tmp/cov2');
const covPaths = covWrites.map((w) => w.path);
ok(covPaths.length === new Set(covPaths).size, `planWrites: no two outputs claim the same path (dupes: ${covPaths.filter((p, i) => covPaths.indexOf(p) !== i).join(', ') || 'none'})`);

// The collision needs a component and a service SHARING a base name — `x.component.ts` + `x.service.ts` — which
// is how a real library is laid out. Without such a pair the uniqueness check above passes vacuously.
const collide = mkdtempSync(join(tmpdir(), 'weave-collide-'));
try {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(collide, 'src'), { recursive: true });
  writeFileSync(join(collide, 'src', 'index.ts'), "import { WidgetComponent } from './widget.component';\nimport { WidgetService } from './widget.service';\nexport { WidgetComponent, WidgetService };\n");
  writeFileSync(join(collide, 'src', 'widget.component.ts'), "import { Component } from '@angular/core';\n@Component({ selector: 'app-widget', template: '' })\nexport class WidgetComponent {}\n");
  writeFileSync(join(collide, 'src', 'widget.service.ts'), "import { Injectable } from '@angular/core';\n@Injectable({ providedIn: 'root' })\nexport class WidgetService { go(): void {} }\n");
  const cf = a.assembleFacts(collide);
  const ps = cv.planWrites(cf, join(collide, 'out')).map((w) => w.path);
  const dupes = ps.filter((p, i) => ps.indexOf(p) !== i);
  ok(dupes.length === 0, `planWrites: widget.component.ts and widget.service.ts do NOT collide (dupes: ${[...new Set(dupes)].map((p) => p.split(/[\\/]/).pop()).join(', ') || 'none'})`);
} finally {
  rmSync(collide, { recursive: true, force: true });
}
const producedFrom = new Set(covWrites.map((w) => (w.path.split(/[\\/]/).pop() ?? '').replace(/\.(ts|html)$/, '')));
const missingFiles = covFacts.files.filter((ff) => {
  const base = (ff.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '').replace(/\.component$/, '');
  return !producedFrom.has(base);
});
ok(missingFiles.length === 0, `EVERY FILE REACHES THE OUTPUT: no walked file produces nothing (missing: ${missingFiles.map((f) => f.split(/[\\/]/).pop()).join(', ') || 'none'})`);
ok(covFacts.coverage.emptyFiles.length === 0, 'coverage: with carrying in place, no file contributes nothing');

// A carried file keeps its code, is labelled, and has its imports repointed at renamed outputs.
const carried = cv.carryFile(join(fx, 'forms', 'grouped.ts'), covFacts);
ok(carried.includes('Carried over from') && carried.includes('chart.group'), 'carryFile: the original code is kept whole, under a header saying it was carried');
const barrel = cv.carryFile(join(fx, 'nx-mono', 'apps', 'shop', 'src', 'app', 'lazy.routes.ts'), covFacts);
ok(!/from\s*['"][^'"]*\.component['"]/.test(barrel), 'carryFile: relative imports are repointed at the renamed component outputs');

// CARRIED IS NOT CONVERTED — the report must keep them apart rather than claiming a flattering 100%.
ok(covFacts.coverage.handled < covFacts.coverage.total, 'coverage: carrying a file does NOT count as converting it');
ok(covFacts.coverage.carried > 0 && covFacts.coverage.handled + covFacts.coverage.carried === covFacts.coverage.total, 'coverage: converted + carried accounts for everything, with no third silent category');

// The anti-lie check has to see a unit that CONTAINS a pipe and a directive — the shop fixture has neither, so
// adding them to HANDLED_KINDS would otherwise be unverified there.
const pd = mkdtempSync(join(tmpdir(), 'weave-pd-'));
try {
  const { mkdirSync, copyFileSync } = await import('node:fs');
  mkdirSync(join(pd, 'src'), { recursive: true });
  writeFileSync(join(pd, 'src', 'index.ts'), "export * from './shorten.pipe';\nexport * from './highlight.directive';\n");
  copyFileSync(join(pipesDir, 'shorten.pipe.ts'), join(pd, 'src', 'shorten.pipe.ts'));
  copyFileSync(join(pipesDir, 'highlight.directive.ts'), join(pd, 'src', 'highlight.directive.ts'));
  const pdFacts = a.assembleFacts(pd);
  ok(pdFacts.pipes.length === 1 && pdFacts.directives.length === 1, 'assembleFacts: pipes and directives are gathered');
  const pdProduced = new Set(cv.planWrites(pdFacts, join(pd, 'out')).map((w) => (w.path.split(/[\\/]/).pop() ?? '').replace(/\.(ts|html|css|scss)$/, '')));
  const pdLies = pdFacts.inventory
    .filter((d) => d.handled)
    .filter((d) => !pdProduced.has((d.file.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '')));
  ok(pdLies.length === 0, `coverage does not LIE about pipes/directives: each really produces output (claimed-but-unwritten: ${pdLies.map((d) => d.name).join(', ') || 'none'})`);
} finally {
  rmSync(pd, { recursive: true, force: true });
}

// The decisive gate for a code GENERATOR: does what it emits actually COMPILE against the real Weave packages?
// Every assertion above checks the shape of a string; this one checks the thing is usable. It type-checks both
// drafts (store + context) with strict TS, resolving @weave-framework/* to the workspace sources.
const genDir = mkdtempSync(join(tmpdir(), 'weave-gen-'));
try {
  writeFileSync(join(genDir, 'root.ts'), cv.convertService(rootSvc).ts);
  writeFileSync(join(genDir, 'scoped.ts'), cv.convertService(scopedSvc).ts);
  writeFileSync(join(genDir, 'guards.ts'), guardsTs);
  writeFileSync(join(genDir, 'login.ts'), formPair.ts);
  writeFileSync(join(genDir, 'http.ts'), httpTs);
  writeFileSync(join(genDir, 'pipe.ts'), pipeTs);
  writeFileSync(join(genDir, 'contexts.ts'), tokTs);
  // The host component: the widest component draft there is — typed props with defaults, translated getters, a
  // field signal that carries its initial value, and an onMount subscription with its cleanup.
  writeFileSync(join(genDir, 'host.ts'), hostPair.ts);
  writeFileSync(join(genDir, 'directive.ts'), dirTs);
  // The constructor + router-events draft, and a service reaching another service this run converts.
  writeFileSync(join(genDir, 'nav.ts'), navTs);
  // The RxJS translation: a Subject that became a signal, a chain that folded into array methods, and a chain
  // that did not fold — the folded code has to type-check, not merely read well.
  // A chain the fold refused keeps its rxjs imports on purpose, so the gate needs rxjs to EXIST. It is not a
  // dependency of this repo, so it is declared ambiently — enough to prove the translated code around it is sound.
  writeFileSync(
    join(genDir, 'rxjs-ambient.d.ts'),
    [
      "declare module 'rxjs' {",
      '  export interface Observable<T> { pipe(...ops: unknown[]): Observable<T> }',
      '}',
      "declare module 'rxjs/operators' {",
      '  export function map(f: (v: any) => any): unknown;',
      '  export function debounceTime(ms: number): unknown;',
      '}',
    ].join('\n'),
  );
  writeFileSync(join(genDir, 'streams.ts'), streamsTs);
  writeFileSync(join(genDir, 'crumbs.ts'), cv.convertService(pairSvcs[0], [], migMap).ts);
  writeFileSync(join(genDir, 'crumbs-path.ts'), consumer.replace("from './crumbs.service'", "from './crumbs'"));
  writeFileSync(
    join(genDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true,
        baseUrl: repo,
        paths: {
          '@weave-framework/runtime': ['packages/runtime/src/index.ts'],
          '@weave-framework/store': ['packages/store/src/index.ts'],
          '@weave-framework/router': ['packages/router/src/index.ts'],
          '@weave-framework/forms': ['packages/forms/src/index.ts'],
          '@weave-framework/data': ['packages/data/src/index.ts'],
        },
      },
      include: ['*.ts'],
    }),
  );
  let tscOut = '';
  let compiled = true;
  try {
    execFileSync(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(genDir, 'tsconfig.json')], { encoding: 'utf8' });
  } catch (e) {
    compiled = false;
    tscOut = String(e.stdout ?? e.message).split('\n').slice(0, 3).join(' ');
  }
  ok(compiled, `generated code COMPILES against the real @weave-framework packages${compiled ? '' : ` — ${tscOut}`}`);
} finally {
  rmSync(genDir, { recursive: true, force: true });
}

// ── M4.9: writing the converted files into the target app — mirrored layout, NEVER overwriting ──
const wdir = mkdtempSync(join(tmpdir(), 'weave-write-'));
try {
  const writes = cv.planWrites(facts, wdir);
  // A .ts+.html pair per component, one .ts per service, and one per remaining file — every file reaches output.
  const carriedCount = facts.files.length - facts.components.length - facts.services.length;
  ok(writes.length === facts.components.length * 2 + facts.services.length + carriedCount, `planWrites: a pair per component, one per service, one per carried file (got ${writes.length})`);
  ok(writes.some((w) => w.path.endsWith('user.service.ts')), 'planWrites: a service keeps its own file name (deriving it from the class collided with the component)');
  // `src/lib/` is ng-packagr plumbing an Angular LIBRARY is required to have. It means nothing in a Weave app,
  // and mirroring it put every migrated component under a folder that exists for no reason.
  const libUnit = mkdtempSync(join(tmpdir(), 'weave-lib-'));
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(libUnit, 'src', 'lib', 'logo'), { recursive: true });
    writeFileSync(join(libUnit, 'src', 'index.ts'), "export * from './lib/logo/logo.component';\n");
    writeFileSync(join(libUnit, 'src', 'lib', 'logo', 'logo.component.ts'), "import { Component } from '@angular/core';\n@Component({ selector: 'sps-logo', template: '' })\nexport class LogoComponent {}\n");
    const libFacts = a.assembleFacts(libUnit);
    const libPaths = cv.planWrites(libFacts, 'OUT').map((w) => w.path);
    ok(libPaths.some((p) => p.endsWith(join('src', 'logo', 'logo.ts'))), `planWrites: the ng-packagr lib/ wrapper is dropped (got ${libPaths.map((p) => p.split('OUT')[1]).join(', ')})`);
    ok(!libPaths.some((p) => p.includes(`${sep}lib${sep}`)), 'planWrites: nothing lands under a lib/ folder any more');
    // Dropping a folder is only safe if the imports that named it are repointed with it.
    const carriedBarrel = cv.carryFile(join(libUnit, 'src', 'index.ts'), libFacts);
    ok(carriedBarrel.includes("export * from './logo/logo';"), 'carryFile: a barrel that pointed into lib/ is repointed, and loses the .component suffix too');
  } finally {
    rmSync(libUnit, { recursive: true, force: true });
  }
  ok(writes.every((w) => w.path.includes(`${sep}src${sep}`)), 'planWrites: everything lands under the target app\'s src/');
  ok(writes.some((w) => w.path.endsWith('app.ts')) && writes.some((w) => w.path.endsWith('app.html')), 'planWrites: app.component.ts becomes app.ts + app.html (the .component suffix is dropped)');
  ok(writes.every((w) => w.status === 'write'), 'planWrites: into an empty app, every file is a fresh write');

  const applied = cv.applyWrites(writes);
  ok(applied.written.length === writes.length && applied.skipped.length === 0, 'applyWrites: writes them all into an empty app');
  ok(existsSync(join(wdir, 'src', 'app', 'app.ts')), 'applyWrites: the file really lands at the mirrored path');
  ok(readFileSync(join(wdir, 'src', 'app', 'app.ts'), 'utf8').includes('export function setup('), 'applyWrites: the .ts holds a Weave setup()');

  // the SAFETY rule: running again must not clobber what is already there (the "existing app" case)
  writeFileSync(join(wdir, 'src', 'app', 'app.ts'), 'MINE — do not touch');
  const again = cv.planWrites(facts, wdir);
  ok(again.some((w) => w.path.endsWith('app.ts') && w.status === 'skip-exists'), 'planWrites: an existing file is marked skip-exists, not write');
  const applied2 = cv.applyWrites(again);
  ok(applied2.skipped.length > 0, 'applyWrites: reports what it left alone');
  ok(readFileSync(join(wdir, 'src', 'app', 'app.ts'), 'utf8') === 'MINE — do not touch', 'applyWrites: an existing file is NEVER overwritten');
} finally {
  rmSync(wdir, { recursive: true, force: true });
}

// a component's inline template text is a FACT the converter needs (not just the boolean flag)
const inlineCmp = facts.components.find((cf) => cf.templateInline);
ok(inlineCmp && typeof inlineCmp.templateText === 'string', 'ComponentFact: an inline template carries its TEXT, so the converter can convert it');
ok(cv.readComponentTemplate({ ...inlineCmp, templateText: '<p>hi</p>' }) === '<p>hi</p>', 'readComponentTemplate: an inline template is returned as-is');
ok(cv.readComponentTemplate({ file: join(shop, 'x.ts'), templateText: null, templateUrl: './nope.html' }) === null, 'readComponentTemplate: an unreadable templateUrl → null (never a fake empty template)');

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

// ── input sanitising: raw mode leaks control bytes that LOOK like a typed line ──
// Reported live twice: picking a framework from the arrow menu answered the NEXT question by itself, with
// "No Angular app found". The confirming keypress leaked into readline as a line that was invisible but NOT
// empty, so the empty-line guard missed it and it was taken for a typed path.
ok(uiOn.sanitize('\x1b[A') === '', 'sanitize: an arrow-key escape sequence is not a typed path');
ok(uiOn.sanitize('\r') === '' && uiOn.sanitize('\x00\x07') === '', 'sanitize: a stray carriage return or control byte is not a typed path');
ok(uiOn.sanitize('  D:/apps/shop  ') === 'D:/apps/shop', 'sanitize: a real path is trimmed and otherwise untouched');
ok(uiOn.sanitize('\x1b[2KC:/_WORK/thing') === 'C:/_WORK/thing', 'sanitize: a path with a leaked escape prefix still resolves to the path');
ok(uiOn.sanitize('C:/Program Files/app') === 'C:/Program Files/app', 'sanitize: spaces inside a path are preserved');
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
