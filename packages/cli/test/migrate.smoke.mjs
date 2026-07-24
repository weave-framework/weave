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

// detectAngularAt — direct signals
ok(m.detectAngularAt(join(fx, 'plain-angular')), 'detectAngularAt: a plain Angular app (angular.json + @angular/core) is detected');
ok(!m.detectAngularAt(join(fx, 'not-angular')), 'detectAngularAt: a React folder is NOT detected');
ok(!m.detectAngularAt(join(fx, 'nx-mono')), 'detectAngularAt: an Nx root has no direct app (its apps are deeper)');

// looksLikeMonorepo
ok(m.looksLikeMonorepo(join(fx, 'nx-mono')), 'looksLikeMonorepo: an Nx root (nx.json + apps/) is a monorepo');
ok(!m.looksLikeMonorepo(join(fx, 'plain-angular')), 'looksLikeMonorepo: a plain app is not a monorepo');

// isNxAngularProject
ok(m.isNxAngularProject(join(fx, 'nx-mono', 'apps', 'shop')), 'isNxAngularProject: an Angular-target project.json is an Angular app');

// findAngularApps — deep search
const apps = m.findAngularApps(join(fx, 'nx-mono')).sort();
ok(apps.length === 2, `findAngularApps: found both apps inside the Nx root (got ${apps.length})`);
ok(apps.some((a) => a.endsWith('shop')) && apps.some((a) => a.endsWith('admin')), 'findAngularApps: the two are apps/shop and apps/admin');

// resolveAngularApp — the whole resolution
ok(m.resolveAngularApp(join(fx, 'plain-angular')).app?.endsWith('plain-angular'), 'resolve: a plain app path resolves to itself');
const nxRes = m.resolveAngularApp(join(fx, 'nx-mono'));
ok(!nxRes.app && nxRes.candidates?.length === 2, 'resolve: an Nx root offers its inner apps as candidates (not the root)');
ok(m.resolveAngularApp(join(fx, 'not-angular')).none === true, 'resolve: a non-Angular folder resolves to none');
ok(m.resolveAngularApp(join(fx, 'does-not-exist')).none === true, 'resolve: a missing path resolves to none');

// a multi-project Angular CLI workspace (angular.json lists several apps) → offer the apps, not the root
const wsProjects = m.readAngularProjects(join(fx, 'ng-workspace')).filter((p) => p.type === 'application');
ok(wsProjects.length === 2, `readAngularProjects: two application projects (got ${wsProjects.length})`);
const wsRes = m.resolveAngularApp(join(fx, 'ng-workspace'));
ok(!wsRes.app && wsRes.candidates?.length === 2, 'resolve: a multi-project angular.json offers its apps (NOT the workspace root)');
ok(wsRes.candidates?.every((c) => c.includes('projects')), 'resolve: the candidates are the project roots (projects/app1, projects/app2)');

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

rmSync(out, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ weave migrate M1 — path resolution works (plain app, Nx deep-detect, none, single-auto).');
