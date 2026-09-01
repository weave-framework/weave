/**
 * The `<script>` the build injects is the ENTRY — not one of the app's lazy routes.
 *
 * esbuild sets `entryPoint` on every code-split chunk it names after a module, so a `lazy()` route is an
 * entry point in the metafile exactly like the real one. The build read "the first output that has an
 * entryPoint", which for an app with 90 lazy routes was whichever route the map yielded first. The
 * documentation site shipped with `index.html` loading a UI component's page module: it fetched, parsed,
 * ran, and mounted nothing. No 404, no console error, no failing build — a blank page.
 *
 * `base-path.smoke.mjs` already asserts the injected name, and stayed green through all of it, because
 * its fixture app has ONE module. With nothing else carrying an entryPoint, the bug cannot appear. So the
 * assertion here is not new; the CORPUS is: an app with several lazy routes, which is what every real one
 * is.
 *
 * Run: `node packages/cli/test/entry-name.smoke.mjs` (wired into `pnpm verify:entry-name`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

console.log('\npackages/cli/test/entry-name.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-entry-name-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/build.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { build } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

const dir = mkdtempSync(join(repo, 'tools', '.verify-entry-name-app-'));
// Removed on the way out, not only on success: the first run of this test threw inside `build`, the
// cleanup below never ran, and the fixture was staged into a release commit.
process.on('exit', () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
writeFileSync(join(dir, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');

// Several routes, each its own module, each reached through a dynamic import — the shape that makes the
// metafile hold more than one entryPoint. Named so that alphabetically they sort BEFORE `main`, which is
// the order the failure needed.
// FORTY of them, not three. With three, esbuild's metafile happened to list the entry first and the
// old implementation passed — a gate that agrees with the bug is worse than no gate. The count is
// what makes the corpus reproduce the ordering a real app has.
const routes = Array.from({ length: 40 }, (_, i) => `page-${String(i).padStart(2, '0')}`);
for (const r of routes) {
  writeFileSync(join(dir, 'src', 'pages', `${r}.ts`), `export function setup() {}\n`);
  writeFileSync(join(dir, 'src', 'pages', `${r}.html`), `<p>${r}</p>\n`);
}
writeFileSync(join(dir, 'src', 'app.ts'), "import { signal } from '@weave-framework/runtime';\nexport function setup() {\n  const n = signal(1);\n  return { n };\n}\n");
writeFileSync(join(dir, 'src', 'app.html'), '<p>{{ n() }}</p>\n');
writeFileSync(
  join(dir, 'src', 'main.ts'),
  "import { mountComponent } from '@weave-framework/runtime/dom';\n" +
    "import App from './app';\n" +
    routes.map((r) => `void (() => import('./pages/${r}'));`).join('\n') +
    "\nmountComponent(App, '#app');\n"
);

await build({
  entry: join(dir, 'src', 'main.ts'),
  outDir: join(dir, 'dist'),
  index: join(dir, 'src', 'index.html'),
  minify: true,
  clean: true,
});

const html = readFileSync(join(dir, 'dist', 'index.html'), 'utf8');
const files = readdirSync(join(dir, 'dist')).filter((f) => f.endsWith('.js'));
const src = (/src="([^"]*)"/.exec(html) ?? [])[1] ?? '';
const injected = src.split('/').pop();

ok(files.length >= routes.length + 1, `the app really did split (${files.length} js files for ${routes.length} lazy routes + the entry)`);
ok(files.includes(injected), `the injected script exists in dist (${injected})`);
// The one assertion that fails on the bug: a route chunk is named after its module, the entry after `main`.
ok(/^main-[A-Za-z0-9]+\.js$/.test(injected ?? ''), `the injected script is the ENTRY, not a route chunk (got ${injected})`);
// And it is the module that actually mounts — the name alone could be a coincidence.
const entryCode = readFileSync(join(dir, 'dist', injected), 'utf8');
ok(/#app/.test(entryCode), 'the injected script is the module that mounts the app');

rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error(`\nentry-name smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('\n✓ the injected entry is the entry, in an app with lazy routes\n');
