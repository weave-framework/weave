/**
 * Node smoke test for @weave-framework/nx — the plugin's inference, executors' arg-building,
 * and generators against a real Nx virtual tree. Bundles the TS plugin on the fly (esbuild,
 * @nx/devkit external), then exercises it with @nx/devkit + @nx/devkit/testing.
 *
 * Run: `node packages/nx/test/nx.smoke.mjs` (wired as `pnpm verify:nx`).
 */
import { build as esbuild } from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { readProjectConfiguration } from '@nx/devkit';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// Bundle the plugin (TS) → a temp ESM module we can import; @nx/devkit stays external.
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'nx-plugin.mjs');
await esbuild({
  entryPoints: [join(here, '..', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['@nx/devkit', 'nx', 'esbuild'],
  outfile: out,
});
const plugin = await import(pathToFileURL(out).href);

console.log('\npackages/nx/test/nx.smoke.mjs');
try {
  /* ---- pure: readOutDir ---- */
  ok(plugin.readOutDir(`export default { outDir: 'foo' }`) === 'foo', 'readOutDir parses a ts config');
  ok(plugin.readOutDir(`{ "outDir": "bar" }`) === 'bar', 'readOutDir parses a json config');
  ok(plugin.readOutDir(`no out dir here`) === 'dist', 'readOutDir defaults to dist');

  /* ---- pure: buildWeaveTargets ---- */
  const targets = plugin.buildWeaveTargets('apps/x', 'weave.config.ts', 'build-out');
  ok(targets.build.command === 'weave build --config weave.config.ts', 'build target command');
  ok(targets.build.options.cwd === 'apps/x', 'build runs with cwd = project root');
  ok(JSON.stringify(targets.build.outputs) === JSON.stringify(['{projectRoot}/build-out']), 'build output = outDir');
  ok(targets.serve.command === 'weave dev --config weave.config.ts', 'serve target command');
  ok(targets.check.command === 'weave check', 'check target command');
  ok(targets.build.cache === true && targets.check.cache === true, 'build + check are cacheable');
  const renamed = plugin.buildWeaveTargets('apps/x', 'weave.config.ts', 'dist', { buildTargetName: 'compile' });
  ok(!!renamed.compile && !renamed.build, 'buildTargetName option renames the target');

  /* ---- pure: buildArgs ---- */
  ok(
    JSON.stringify(plugin.buildArgs('build', { config: 'weave.config.ts', noMinify: true })) ===
      JSON.stringify(['build', '--config', 'weave.config.ts', '--no-minify']),
    'buildArgs build + --no-minify'
  );
  ok(
    JSON.stringify(plugin.buildArgs('dev', { port: 4200 })) === JSON.stringify(['dev', '--port', '4200']),
    'buildArgs dev + --port'
  );
  // FW-1: outputPath is forwarded as --out (and wins over outDir).
  ok(
    JSON.stringify(plugin.buildArgs('build', { outputPath: '/ws/dist/apps/x' })) ===
      JSON.stringify(['build', '--out', '/ws/dist/apps/x']),
    'buildArgs forwards outputPath as --out'
  );

  /* ---- FW-1: withBuildDefaults — Nx-convention output at <workspaceRoot>/dist/<projectRoot> ---- */
  const fwCtx = {
    root: '/ws',
    projectName: 'x',
    projectsConfigurations: { projects: { x: { root: 'apps/x' } } },
  };
  const defaulted = plugin.withBuildDefaults('build', {}, fwCtx);
  ok(
    defaulted.outputPath === join('/ws', 'dist', 'apps/x'),
    `build defaults outputPath to <workspaceRoot>/dist/<projectRoot> (got ${defaulted.outputPath})`
  );
  const defaultedArgs = plugin.buildArgs('build', defaulted);
  ok(
    defaultedArgs.includes('--out') && defaultedArgs.includes(join('/ws', 'dist', 'apps/x')),
    'the defaulted outputPath reaches the CLI via --out'
  );
  ok(
    plugin.withBuildDefaults('build', { outputPath: '/custom' }, fwCtx).outputPath === '/custom',
    'an explicit outputPath override is respected (no default applied)'
  );
  ok(
    plugin.withBuildDefaults('build', { outDir: 'dist' }, fwCtx).outputPath === undefined,
    'an explicit outDir suppresses the workspace default (standalone-style behavior)'
  );
  ok(
    plugin.withBuildDefaults('dev', {}, fwCtx).outputPath === undefined,
    'non-build commands are not given a build outputPath'
  );

  /* ---- inference: createNodesV2 against a fixture workspace ---- */
  const fixtureWs = join(here, 'fixture-ws');
  const context = { workspaceRoot: fixtureWs, nxJsonConfiguration: {}, configFiles: ['myapp/weave.config.ts'] };
  const results = await plugin.createNodesV2[1](['myapp/weave.config.ts'], {}, context);
  const [, res] = results[0];
  const proj = res.projects['myapp'];
  ok(!!proj, 'inference registered the myapp project');
  ok(proj.targets.build.command === 'weave build --config weave.config.ts', 'inferred build command');
  ok(
    JSON.stringify(proj.targets.build.outputs) === JSON.stringify(['{projectRoot}/build-out']),
    'inferred outputs read outDir from the config'
  );

  /* ---- inference guard: a config with no project marker is skipped ---- */
  const noMarker = await plugin.createNodesV2[1](['nowhere/weave.config.ts'], {}, context);
  ok(!noMarker[0] || Object.keys(noMarker[0][1].projects ?? {}).length === 0, 'no project.json/package.json → skipped');

  /* ---- generators: application + component against a real Nx tree ---- */
  const tree = createTreeWithEmptyWorkspace();
  const appTask = await plugin.applicationGenerator(tree, { name: 'shop', style: 'scss' });
  ok(tree.exists('apps/shop/weave.config.ts'), 'app generator wrote weave.config.ts');
  ok(tree.exists('apps/shop/tsconfig.json'), 'app generator wrote a project-local tsconfig.json (scopes it as a Weave TS project)');
  ok(tree.exists('apps/shop/src/app/app.html'), 'app generator wrote the root component template');
  ok(tree.read('apps/shop/weave.config.ts', 'utf-8').includes("styleLang: 'scss'"), 'app config honors style');
  const shopCfg = readProjectConfiguration(tree, 'shop');
  ok(shopCfg.targets.build.executor === '@weave-framework/nx:build', 'app registered with the build executor');
  ok(shopCfg.projectType === 'application', 'registered as an application');
  // FW-1: the build target's outputs point at the workspace-root dist (Nx convention), not app-local.
  ok(
    JSON.stringify(shopCfg.targets.build.outputs) === JSON.stringify(['{workspaceRoot}/dist/{projectRoot}']),
    'FW-1: build outputs = {workspaceRoot}/dist/{projectRoot}'
  );
  // "Use the plugin you built": the app ships a .prettierrc wiring @weave-framework/prettier-plugin
  // so Weave templates format instead of getting mangled.
  ok(tree.exists('apps/shop/.prettierrc'), 'app generator writes a .prettierrc');
  const prettierrc = JSON.parse(tree.read('apps/shop/.prettierrc', 'utf-8') || '{}');
  ok(
    (prettierrc.plugins ?? []).includes('@weave-framework/prettier-plugin'),
    '.prettierrc registers @weave-framework/prettier-plugin'
  );
  ok(
    (prettierrc.overrides ?? []).some((o) => /\.html|\*\.html|html/.test(o.files) && o.options?.parser === 'weave'),
    '.prettierrc routes .html templates to the weave parser'
  );
  // bug1: a generator must return void or a callback FUNCTION — returning a string (the project
  // root) broke `nx g` at the end with "task is not a function".
  ok(typeof appTask === 'function', 'app generator returns a task callback (function), not a string');
  // bug2: the scaffold imports @weave-framework/* at runtime — the generator must add them to package.json.
  const rootPkg = JSON.parse(tree.read('package.json', 'utf-8') || '{}');
  ok(!!rootPkg.dependencies?.['@weave-framework/runtime'], 'app generator adds @weave-framework/runtime to dependencies');
  ok(!!rootPkg.devDependencies?.['@weave-framework/cli'], 'app generator adds @weave-framework/cli to devDependencies');
  ok(
    !!rootPkg.devDependencies?.['@weave-framework/prettier-plugin'],
    'app generator adds @weave-framework/prettier-plugin to devDependencies (formats Weave templates)'
  );
  // bug3: Weave `{{ }}` bindings must survive verbatim — formatFiles (Prettier) mangles
  // `on:click={{ inc }}` into `on:click="{{" inc }}`, so the template is written after formatting.
  const appHtml = tree.read('apps/shop/src/app/app.html', 'utf-8');
  ok(appHtml.includes('on:click={{ inc }}'), 'app.html keeps the canonical on:click={{ inc }} binding');
  ok(!appHtml.includes('on:click="{{'), 'app.html is not Prettier-mangled');
  // bug4: `count.set(...)` returns the value, so an expression-body `(): void =>` arrow trips
  // TS2322 (number not assignable to void). The starter must use a block body.
  const appTs = tree.read('apps/shop/src/app/app.ts', 'utf-8');
  ok(
    appTs.includes('(): void => {') && !appTs.includes('(): void => count.set'),
    'app.ts uses a block-body void arrow (expression body would return number → TS2322)'
  );

  await plugin.componentGenerator(tree, { name: 'UserCard', project: 'shop', style: 'css' });
  ok(tree.exists('apps/shop/src/user-card/user-card.ts'), 'component generator wrote kebab .ts');
  ok(tree.exists('apps/shop/src/user-card/user-card.html'), 'component generator wrote .html');
  ok(tree.exists('apps/shop/src/user-card/user-card.css'), 'component generator wrote .css');
  const compHtml = tree.read('apps/shop/src/user-card/user-card.html', 'utf-8');
  ok(
    compHtml.includes('on:click={{ inc }}') && !compHtml.includes('on:click="{{'),
    'component .html keeps the canonical binding'
  );
  const compTs = tree.read('apps/shop/src/user-card/user-card.ts', 'utf-8');
  ok(
    compTs.includes('(): void => {') && !compTs.includes('(): void => count.set'),
    'component .ts uses a block-body void arrow (avoids the TS2322 void-return trap)'
  );

  const libTask = await plugin.libraryGenerator(tree, { name: 'ui-kit', style: 'none' });
  ok(tree.exists('libs/ui-kit/src/index.ts'), 'library generator wrote a barrel index');
  ok(!tree.exists('libs/ui-kit/src/lib/ui-kit/ui-kit.css'), 'style "none" omitted the stylesheet');
  ok(readProjectConfiguration(tree, 'ui-kit').projectType === 'library', 'registered as a library');
  ok(typeof libTask === 'function', 'library generator returns a task callback (function)');

  /* ---- FW-3: every executor declared in executors.json actually ships ---- */
  // Root cause of the missing `build` executor: the unanchored `.gitignore` rule `build/` swallowed
  // `packages/nx/src/executors/build/`, so its source was never committed and the published tarball
  // had no `build` executor (`nx build` → "Unable to resolve @weave-framework/nx:build"). Guard it:
  // for each executor, its SOURCE must exist and must NOT be gitignored; and if dist is built, the
  // compiled implementation + schema must be present (the paths `executors.json` points npm at).
  const nxRoot = join(here, '..');
  const execManifest = JSON.parse(readFileSync(join(nxRoot, 'executors.json'), 'utf-8')).executors;
  const distBuilt = existsSync(join(nxRoot, 'dist', 'executors'));
  const isIgnored = (relFromRepo) => {
    try {
      execFileSync('git', ['check-ignore', '-q', relFromRepo], { cwd: repo, stdio: 'pipe' });
      return true; // exit 0 → ignored
    } catch {
      return false; // exit 1 → not ignored
    }
  };
  for (const [name, def] of Object.entries(execManifest)) {
    const implSrc = def.implementation.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    const schemaSrc = def.schema.replace(/^\.\/dist\//, 'src/');
    ok(existsSync(join(nxRoot, implSrc)), `executor '${name}': source ${implSrc} exists`);
    ok(existsSync(join(nxRoot, schemaSrc)), `executor '${name}': schema source ${schemaSrc} exists`);
    ok(!isIgnored(`packages/nx/${implSrc}`), `executor '${name}': source is NOT gitignored (else it never publishes)`);
    if (distBuilt) {
      ok(existsSync(join(nxRoot, def.implementation.replace(/^\.\//, ''))), `executor '${name}': built ${def.implementation} resolves on disk`);
      ok(existsSync(join(nxRoot, def.schema.replace(/^\.\//, ''))), `executor '${name}': built ${def.schema} resolves on disk`);
    }
  }

  /* ---- packaging: exports must expose ./package.json (Nx reads it to find generators) ---- */
  const nxPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'));
  ok(!!nxPkg.exports?.['./package.json'], 'dev exports exposes ./package.json (Nx needs it)');
  ok(
    !!nxPkg.publishConfig?.exports?.['./package.json'],
    'publishConfig.exports exposes ./package.json (the PUBLISHED map — its absence broke @weave-framework/nx@1.0.2)'
  );
} catch (e) {
  ok(false, `threw: ${e.stack ?? e.message}`);
}

console.log(`\n${'-'.repeat(40)}`);
console.log(failures ? `nx smoke: ${failures} failed` : 'nx smoke: all passed');
process.exit(failures ? 1 : 0);
