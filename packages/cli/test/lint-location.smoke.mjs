/**
 * A template mistake must be reported at the line it is on, in the file it is in.
 *
 * The five template lint rules have always produced the right SENTENCE, but the loader attached every
 * one of them to the component module with no position at all — so `on:clik` buried in a 200-line
 * template said only "this component", and it named the `.ts`, which is not even the file the mistake
 * is in. The message was correct and unusable.
 *
 * This drives the real plugin through a real esbuild run and reads the warnings esbuild would print.
 * The fixture lives inside the repo (not the OS temp dir) so `@weave-framework/*` resolves.
 *
 * Run: `node packages/cli/test/lint-location.smoke.mjs` (wired into `pnpm verify:lint-location`).
 */
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else {
    console.log('+ ' + msg);
  }
};

console.log('\npackages/cli/test/lint-location.smoke.mjs');

const pluginJs = join(repo, 'tools', '.verify-lint-location-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/plugin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: pluginJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { weave } = await import(pathToFileURL(pluginJs).href);
process.on('exit', () => rmSync(pluginJs, { force: true }));

const app = mkdtempSync(join(repo, 'tools', '.verify-lint-location-app-'));
const dir = join(app, 'src', 'app');
mkdirSync(dir, { recursive: true });

writeFileSync(join(dir, 'app.ts'), 'export function setup(): { inc: () => void } {\n  return { inc: (): void => {} };\n}\n');
// The typo is on line 3 of the TEMPLATE, and the template is its own file.
writeFileSync(join(dir, 'app.html'), '<div>\n  <p>hello</p>\n  <button on:clik={{ inc }}>x</button>\n</div>\n');

const result = await build({
  entryPoints: [join(dir, 'app.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
  external: ['@weave-framework/*'],
  plugins: [weave({ css: [] }, {})],
});

const w = result.warnings;
ok(w.length === 1, 'exactly one warning (got ' + JSON.stringify(w.map((x) => x.text)) + ')');

const loc = w[0]?.location ?? {};
ok(basename(loc.file ?? '') === 'app.html', 'it names the TEMPLATE file, not the .ts (got ' + loc.file + ')');
ok(loc.line === 3, 'at the line the mistake is on (got ' + loc.line + ')');
ok((loc.lineText ?? '').includes('on:clik'), 'and frames that line (got ' + JSON.stringify(loc.lineText) + ')');
ok((w[0]?.text ?? '').includes('on:click'), 'the message still names the fix');

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' lint-location check(s) failed\n');
  process.exit(1);
}
console.log('\n+ a template mistake is reported at its own file and line\n');
process.exit(0);
