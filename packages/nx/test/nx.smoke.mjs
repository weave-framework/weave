/**
 * Node smoke test for @weave-framework/nx — the plugin's inference, executors' arg-building,
 * and generators against a real Nx virtual tree. Bundles the TS plugin on the fly (esbuild,
 * @nx/devkit external), then exercises it with @nx/devkit + @nx/devkit/testing.
 *
 * Run: `node packages/nx/test/nx.smoke.mjs` (wired as `pnpm verify:nx`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
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
  ok(tree.exists('apps/shop/src/app/app.html'), 'app generator wrote the root component template');
  ok(tree.read('apps/shop/weave.config.ts', 'utf-8').includes("styleLang: 'scss'"), 'app config honors style');
  const shopCfg = readProjectConfiguration(tree, 'shop');
  ok(shopCfg.targets.build.executor === '@weave-framework/nx:build', 'app registered with the build executor');
  ok(shopCfg.projectType === 'application', 'registered as an application');
  // bug1: a generator must return void or a callback FUNCTION — returning a string (the project
  // root) broke `nx g` at the end with "task is not a function".
  ok(typeof appTask === 'function', 'app generator returns a task callback (function), not a string');
  // bug2: the scaffold imports @weave-framework/* at runtime — the generator must add them to package.json.
  const rootPkg = JSON.parse(tree.read('package.json', 'utf-8') || '{}');
  ok(!!rootPkg.dependencies?.['@weave-framework/runtime'], 'app generator adds @weave-framework/runtime to dependencies');
  ok(!!rootPkg.devDependencies?.['@weave-framework/cli'], 'app generator adds @weave-framework/cli to devDependencies');
  // bug3: Weave `{{ }}` bindings must survive verbatim — formatFiles (Prettier) mangles
  // `on:click={{ inc }}` into `on:click="{{" inc }}`, so the template is written after formatting.
  const appHtml = tree.read('apps/shop/src/app/app.html', 'utf-8');
  ok(appHtml.includes('on:click={{ inc }}'), 'app.html keeps the canonical on:click={{ inc }} binding');
  ok(!appHtml.includes('on:click="{{'), 'app.html is not Prettier-mangled');

  await plugin.componentGenerator(tree, { name: 'UserCard', project: 'shop', style: 'css' });
  ok(tree.exists('apps/shop/src/user-card/user-card.ts'), 'component generator wrote kebab .ts');
  ok(tree.exists('apps/shop/src/user-card/user-card.html'), 'component generator wrote .html');
  ok(tree.exists('apps/shop/src/user-card/user-card.css'), 'component generator wrote .css');
  const compHtml = tree.read('apps/shop/src/user-card/user-card.html', 'utf-8');
  ok(
    compHtml.includes('on:click={{ inc }}') && !compHtml.includes('on:click="{{'),
    'component .html keeps the canonical binding'
  );

  const libTask = await plugin.libraryGenerator(tree, { name: 'ui-kit', style: 'none' });
  ok(tree.exists('libs/ui-kit/src/index.ts'), 'library generator wrote a barrel index');
  ok(!tree.exists('libs/ui-kit/src/lib/ui-kit/ui-kit.css'), 'style "none" omitted the stylesheet');
  ok(readProjectConfiguration(tree, 'ui-kit').projectType === 'library', 'registered as a library');
  ok(typeof libTask === 'function', 'library generator returns a task callback (function)');

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
