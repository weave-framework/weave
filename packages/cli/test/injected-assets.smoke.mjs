/**
 * Every URL the build injects into the HTML must name a file the build actually wrote.
 *
 * Nothing checked this. `weave build` composes the script and stylesheet URLs by hand — a fixed name
 * plus a content query — and writes them into a copy of the shell. If the emitted filename and the
 * composed URL ever disagree, the result is a page that loads, renders nothing, and reports no error:
 * the browser 404s the module and the mount never happens. That is the silent failure this gate exists
 * to make loud, and it is why it was written BEFORE moving those names to content hashes.
 *
 * It reads the built `index.html`, takes every local `src`/`href` it finds, strips the query, and
 * requires the file to be there. It also checks a prerendered page, since `--ssg` writes the same URLs
 * into every route it generates and could drift on its own.
 *
 * Run: `node packages/cli/test/injected-assets.smoke.mjs` (wired into `pnpm verify:injected-assets`).
 */
import { build as esbuild } from 'esbuild';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

console.log('\npackages/cli/test/injected-assets.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-injected-assets-bundle.mjs');
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

const app = mkdtempSync(join(repo, 'tools', '.verify-injected-assets-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
writeFileSync(
  join(app, 'weave.config.ts'),
  "import { defineConfig } from '@weave-framework/cli';\n\nexport default defineConfig({ root: 'src/app/app', index: 'index.html', outDir: 'dist', styles: ['src/styles.css'] });\n"
);
writeFileSync(join(app, 'src', 'styles.css'), 'body { margin: 0 }\n');
writeFileSync(join(app, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>\n');
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  'export function setup(): { count: number } {\n  const count = 1;\n  return { count };\n}\n'
);
writeFileSync(join(app, 'src', 'app', 'app.html'), '<div>{{ count }}</div>\n');

const run = async (args) => {
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const cwd = process.cwd();
  const said = [];
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  process.exit = () => {
    throw new Error('__exit__');
  };
  process.chdir(app);
  try {
    await main(args);
  } catch (e) {
    if (!String(e && e.message).includes('__exit__')) said.push(String(e?.message ?? e));
  } finally {
    process.chdir(cwd);
    console.log = realLog;
    console.error = realErr;
    process.exit = realExit;
  }
  return said.join('\n');
};

/** Every local URL an HTML document references, query stripped. */
const referenced = (html) =>
  [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'))
    .map((u) => u.split('?')[0].replace(/^\//, ''));

await run(['build']);
const dist = join(app, 'dist');
const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
const urls = referenced(indexHtml);

ok(urls.length >= 2, `the shell references the script and the stylesheet (${JSON.stringify(urls)})`);
for (const u of urls) ok(existsSync(join(dist, u)), `${u} exists in the output`);
ok(/<script[^>]+type="module"/.test(indexHtml), 'and the script is a module');

/* ── The same URLs are written into every prerendered page, so check one ── */
await run(['build', '--ssg']);
const ssgIndex = readFileSync(join(dist, 'index.html'), 'utf8');
for (const u of referenced(ssgIndex)) ok(existsSync(join(dist, u)), `--ssg: ${u} exists in the output`);

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`injected-assets smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('injected-assets smoke passed\n');
