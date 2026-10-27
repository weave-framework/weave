/**
 * The UI library installs in one step, with no Sass.
 *
 * Before this, the first `<Button>` was four steps and three of them were about styles; miss one and the
 * control rendered unstyled with nothing said. Two things make it one step, and both are pinned here:
 *
 *  1. the package ships a prebuilt `weave-ui.css` — the default theme on `:root` plus every component's
 *     structural CSS, unscoped (a `[data-w-…]` prefix on `:root` is the selector that can never match);
 *  2. a `styles` entry in `weave.config.ts` may name a PACKAGE's stylesheet
 *     (`'@weave-framework/ui/weave-ui.css'`), resolved through node, not only a file under the project.
 *
 * The second half is proven with the real CLI: a plain-CSS app (no `styleLang`, no Sass) with that one
 * line builds, and the stylesheet it emits carries the tokens and a component's rules.
 *
 * Run: `pnpm verify:ui-css` (or `node tools/verify-ui-css.mjs`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeUiCss } from './build-ui-css.mjs';
import { builtAssets } from './built-assets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\ntools/verify-ui-css.mjs');

/* ── 1. the prebuilt stylesheet ── */
const out = await writeUiCss();
const css = readFileSync(out, 'utf8');
ok(existsSync(out) && css.length > 10_000, `dist/weave-ui.css is written and substantial (${css.length} chars)`);
ok(/:root\s*\{[^}]*--weave-color-accent:/.test(css), 'the default theme lands on :root (--weave-color-accent)');
ok(/--weave-button-/.test(css), 'component tokens are present (--weave-button-*)');
ok(!/\[data-w-/.test(css), 'nothing in it is component-scoped (a scoped :root can never match)');

const pkg = JSON.parse(readFileSync(join(root, 'packages', 'ui', 'package.json'), 'utf8'));
ok(pkg.exports['./weave-ui.css'] === './dist/weave-ui.css', 'the package exports ./weave-ui.css (workspace map)');
ok(pkg.publishConfig.exports['./weave-ui.css'] === './dist/weave-ui.css', 'the package exports ./weave-ui.css (published map)');

/* ── 2. one line in a plain-CSS app, through the real CLI ── */
const app = mkdtempSync(join(root, 'tools', '.verify-ui-css-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
const NL = String.fromCharCode(10);
writeFileSync(
  join(app, 'src', 'app', 'app.ts'),
  ["import Button from '@weave-framework/ui/button';", 'export function setup() {', '  const save = (): void => {};', '}', ''].join(NL)
);
writeFileSync(join(app, 'src', 'app', 'app.html'), '<main><Button variant="primary" on:click={{ save }}>Save</Button></main>' + NL);
writeFileSync(join(app, 'src', 'app', 'app.css'), 'main { padding: 1rem; }' + NL); // plain CSS: no styleLang switch
writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
writeFileSync(
  join(app, 'weave.config.ts'),
  [
    "import { defineConfig } from '@weave-framework/cli';",
    'export default defineConfig({',
    "  root: 'src/app/app',",
    "  index: 'src/index.html',",
    "  outDir: 'dist',",
    "  styles: ['@weave-framework/ui/weave-ui.css'],",
    '});',
    '',
  ].join(NL)
);

let built = '';
try {
  built = execFileSync(process.execPath, [join(root, 'packages', 'cli', 'bin', 'weave.mjs'), 'build'], {
    cwd: app,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ok(true, 'weave build succeeds with the one-line styles entry');
} catch (e) {
  ok(false, `weave build succeeds with the one-line styles entry (exit ${e.status}: ${String(e.stderr || e.stdout).trim().split(NL).slice(-3).join(' | ')})`);
}
if (built) {
  const dist = join(app, 'dist');
  const appCss = readFileSync(join(dist, builtAssets(dist).css), 'utf8');
  ok(/--weave-color-accent:/.test(appCss), 'the built stylesheet carries the theme tokens');
  ok(/--weave-button-/.test(appCss), 'the built stylesheet carries the button rules');
  // The component's own stylesheet is SCOPED (`main[data-w-…]`), which is exactly what the global entry
  // must not be — both halves in one sheet, in that order.
  ok(/main\[data-w-[^\]]+\]\s*\{/.test(appCss), "and the app's own (scoped) component CSS is still there after it");
  ok(appCss.indexOf('--weave-color-accent') < appCss.search(/main\[data-w-/), 'the library CSS comes first, so the app overrides it');
}

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error(`\nX ${failed} ui-css check(s) failed\n`);
  process.exit(1);
}
console.log('\n+ the UI library installs with one styles line and no Sass\n');
