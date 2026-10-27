/**
 * `weave add component <Name>` — the generator a newcomer can reach.
 *
 * The generator existed (`weave_scaffold_component` in @weave-framework/mcp) and only an AI editor could
 * call it; everyone else created the two or three files by hand and guessed the naming convention. The
 * command writes them next to the root component, in the project's own style language, in the short form
 * the quick start teaches, and says how to use the result. It refuses to overwrite.
 *
 * Pinned: the files land where a PascalCase tag in the root template finds them (`./user-card/user-card`
 * from the parent's directory), the generated component has no hand-written `return`, the project's
 * `styleLang` decides the stylesheet, `--style none` skips it, a second run refuses rather than clobbers,
 * and the result BUILDS when used from the root template.
 *
 * Run: `node packages/cli/test/add-component.smoke.mjs` (wired into `pnpm verify:add-component`).
 */
import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/add-component.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-add-component-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { main } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

const NL = String.fromCharCode(10);
const mkApp = (styleLang) => {
  const app = mkdtempSync(join(repo, 'tools', '.verify-add-component-app-'));
  mkdirSync(join(app, 'src', 'app'), { recursive: true });
  writeFileSync(join(app, 'src', 'app', 'app.ts'), 'export function setup() {}' + NL);
  writeFileSync(join(app, 'src', 'app', 'app.html'), '<main><h1>Hi</h1></main>' + NL);
  writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  writeFileSync(
    join(app, 'weave.config.ts'),
    "import { defineConfig } from '@weave-framework/cli';" +
      NL +
      `export default defineConfig({ root: 'src/app/app', index: 'src/index.html', outDir: 'dist'${styleLang ? `, styleLang: '${styleLang}'` : ''} });` +
      NL
  );
  return app;
};

/** Run the CLI in-process from `cwd`, capturing what it printed and whether it tried to exit non-zero. */
const run = async (cwd, args) => {
  const said = [];
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const prev = process.cwd();
  let code = 0;
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  process.exit = (c) => {
    code = c ?? 0;
    throw new Error('__exit__');
  };
  process.chdir(cwd);
  try {
    await main(args);
  } catch (e) {
    if (e.message !== '__exit__') throw e;
  } finally {
    process.chdir(prev);
    console.log = realLog;
    console.error = realErr;
    process.exit = realExit;
  }
  return { code, out: said.join(NL) };
};

/* ── 1. a plain-CSS project ── */
{
  const app = mkApp(undefined);
  const r = await run(app, ['add', 'component', 'UserCard']);
  ok(r.code === 0, `weave add component UserCard exits 0 (got ${r.code}: ${r.out.slice(0, 200)})`);
  const dir = join(app, 'src', 'app', 'user-card');
  ok(existsSync(join(dir, 'user-card.ts')), 'writes user-card/user-card.ts next to the root component');
  ok(existsSync(join(dir, 'user-card.html')), 'writes user-card/user-card.html');
  ok(existsSync(join(dir, 'user-card.css')), 'writes user-card/user-card.css (the project is plain CSS)');
  const ts = existsSync(join(dir, 'user-card.ts')) ? readFileSync(join(dir, 'user-card.ts'), 'utf8') : '';
  ok(!/\breturn\b/.test(ts), 'the generated setup() has no hand-written return (the compiler writes it)');
  ok(!/: Signal</.test(ts), 'and no type annotations the quick start does not teach');
  ok(/<UserCard/.test(r.out), 'it says how to use the result (<UserCard …>)');

  // Refuses to overwrite.
  const stamp = 'KEEP ME';
  writeFileSync(join(dir, 'user-card.ts'), stamp);
  const again = await run(app, ['add', 'component', 'UserCard']);
  ok(again.code !== 0, `a second run exits non-zero (got ${again.code})`);
  ok(readFileSync(join(dir, 'user-card.ts'), 'utf8') === stamp, 'and the existing file is untouched');
  ok(/already exists/.test(again.out), 'and it names the problem');

  // The result builds when used from the root template.
  writeFileSync(join(dir, 'user-card.ts'), ts);
  writeFileSync(join(app, 'src', 'app', 'app.html'), '<main><h1>Hi</h1><UserCard /></main>' + NL);
  let built = true;
  try {
    execFileSync(process.execPath, [join(repo, 'packages', 'cli', 'bin', 'weave.mjs'), 'build'], { cwd: app, stdio: 'pipe' });
  } catch (e) {
    built = false;
    console.error(String(e.stderr || e.stdout));
  }
  ok(built, 'the root template renders <UserCard /> and the app builds');
  if (built) {
    const dist = join(app, 'dist');
    const js = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join(NL);
    ok(/user-card/.test(js), 'the built bundle contains the new component');
  }
  rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/* ── 2. the project's styleLang decides the stylesheet; --style none skips it ── */
{
  const app = mkApp('scss');
  await run(app, ['add', 'component', 'price-tag']);
  ok(existsSync(join(app, 'src', 'app', 'price-tag', 'price-tag.scss')), 'an scss project gets price-tag.scss');
  ok(!existsSync(join(app, 'src', 'app', 'price-tag', 'price-tag.css')), 'and no .css');
  await run(app, ['add', 'component', 'Bare', '--style', 'none']);
  const bare = join(app, 'src', 'app', 'bare');
  ok(existsSync(join(bare, 'bare.ts')) && existsSync(join(bare, 'bare.html')), '--style none still writes the .ts and .html');
  ok(!existsSync(join(bare, 'bare.scss')) && !existsSync(join(bare, 'bare.css')), 'and no stylesheet');
  // `--dir` puts it elsewhere.
  await run(app, ['add', 'component', 'Footer', '--dir', 'src/shared']);
  ok(existsSync(join(app, 'src', 'shared', 'footer', 'footer.ts')), '--dir src/shared puts it under src/shared/footer/');
  rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/* ── 3. a missing name is a message, not a stack ── */
{
  const app = mkApp(undefined);
  const r = await run(app, ['add', 'component']);
  ok(r.code !== 0 && /name/i.test(r.out), `weave add component with no name says so (got ${r.code}: ${r.out.slice(0, 120)})`);
  const r2 = await run(app, ['add', 'widget', 'X']);
  ok(r2.code !== 0 && /component/.test(r2.out), `weave add <unknown> names what can be added (got ${r2.code}: ${r2.out.slice(0, 120)})`);
  rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

if (failed) {
  console.error(`\nX ${failed} add-component check(s) failed\n`);
  process.exit(1);
}
console.log(NL + '+ weave add component writes a component where the template finds it, and it builds' + NL);
process.exit(0);
