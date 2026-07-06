/**
 * Node smoke test for @weave-framework/prettier-plugin. Bundles the TS plugin on the fly (esbuild,
 * `prettier` external), then runs `prettier.format` through it and asserts:
 *   - Weave templates format with no SyntaxError (both .weave SFCs and Weave .html files),
 *   - the output is idempotent (format twice ⇒ no change),
 *   - re-parsing the formatted output yields the SAME normalized AST (no semantic change —
 *     attribute kinds, comments, and `@@` escaping all preserved),
 *   - embedded expressions are formatted,
 *   - plain .html NOT routed to the `weave` parser is left to Prettier's HTML formatter.
 *
 * Run: `node packages/prettier-plugin/test/format.smoke.mjs` (wired as `pnpm verify:prettier`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import prettier from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// Bundle the plugin (TS + @weave-framework/compiler) → a temp ESM module; keep `prettier` external.
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'prettier-plugin.mjs');
await esbuild({
  entryPoints: [join(here, '..', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['prettier'],
  outfile: out,
});
const plugin = await import(pathToFileURL(out).href);
// The compiler's parser, bundled the same way, to compare ASTs before/after formatting.
const compilerOut = join(cacheDir, 'compiler-for-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'compiler', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: compilerOut,
});
const { parseTemplate } = await import(pathToFileURL(compilerOut).href);

const fmt = (src, filepath) => prettier.format(src, { parser: 'weave', plugins: [plugin], filepath });

/** Canonicalize an AST for the "no semantic change" comparison. Ignores what the formatter is
 *  ALLOWED to change (reindentation, whitespace-only text, expression formatting — whitespace &
 *  quote style — and source offsets) while keeping everything it must NOT change: tree shape,
 *  element tags, attribute KINDS + names, comments, and `@@`-escaped text. If the formatter dropped
 *  a comment, changed an attribute kind, or failed to re-escape `@@` (so `@if` text became a live
 *  block), the shapes diverge and this fails. */
const EXPR_KEYS = new Set(['expr', 'cond', 'list', 'track', 'test', 'ms']);
function canon(v) {
  if (Array.isArray(v)) {
    return v.filter((x) => !(x && x.type === 'text' && /^\s*$/.test(x.value))).map(canon);
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (k.toLowerCase().endsWith('offset')) continue;
      else if (k === 'value' && (v.type === 'text' || v.type === 'comment')) o[k] = val.replace(/\s+/g, ' ').trim();
      else if (EXPR_KEYS.has(k) && typeof val === 'string') o[k] = val.replace(/\s+/g, '').replace(/['"]/g, '"');
      else o[k] = canon(val);
    }
    return o;
  }
  return v;
}
const astOf = (src) => canon(parseTemplate(src, { comments: true }));

console.log('\npackages/prettier-plugin/test/format.smoke.mjs');

/* ── 1. representative Weave .html template ── */
{
  const src = `<div  class="card"  id="x">
<Button variant={{'icon'}} label={{ t( 'shell.nav.label' ) }} on:click={{toggleNav}}>Save</Button>
<!--   a note   -->
@if (count>0){<span>{{  count }} items</span>}@else{<span>none</span>}
@for (item of items ; track item.id){<li class:done={{item.done}}>{{item.name}}</li>}@empty{<li>empty</li>}
<p>Hello  @@if  <b>world</b></p>
</div>`;
  let f1;
  try {
    f1 = await fmt(src, 'nav.html');
    ok(true, 'formats a representative .html template without throwing');
  } catch (e) {
    ok(false, `formats without throwing — threw: ${e.message}`);
  }
  if (f1) {
    const f2 = await fmt(f1, 'nav.html');
    ok(f1 === f2, 'idempotent (format twice ⇒ identical)');
    ok(JSON.stringify(astOf(src)) === JSON.stringify(astOf(f1)), 'no semantic change (normalized AST equal before/after)');
    ok(/label=\{\{ t\("shell\.nav\.label"\) \}\}/.test(f1) || /label=\{\{ t\('shell\.nav\.label'\) \}\}/.test(f1), 'embedded expression is formatted (inner spaces normalized)');
    ok(f1.includes('@@if'), '`@@` escaping preserved in text');
    ok(f1.includes('<!-- a note -->'), 'HTML comment preserved');
    ok(f1.includes('class:done={{ item.done }}'), 'binding kind preserved (class:)');
  }
}

/* ── 2. .weave SFC ── */
{
  const src = `<script>
const  count=signal(0)
</script>
<div>{{ count() }}</div>
<style>
.x{color:red}
</style>`;
  let f1;
  try {
    f1 = await fmt(src, 'Counter.weave');
    ok(true, 'formats a .weave SFC without throwing');
  } catch (e) {
    ok(false, `formats .weave without throwing — threw: ${e.message}`);
  }
  if (f1) {
    const f2 = await fmt(f1, 'Counter.weave');
    ok(f1 === f2, '.weave idempotent');
    ok(/<script>[\s\S]*const count = signal\(0\)[\s\S]*<\/script>/.test(f1), 'SFC <script> formatted via typescript');
    ok(/<style>[\s\S]*\.x \{[\s\S]*<\/style>/.test(f1), 'SFC <style> formatted via css');
    const iScript = f1.indexOf('<script'), iTemplate = f1.indexOf('<div'), iStyle = f1.indexOf('<style');
    ok(iScript < iTemplate && iTemplate < iStyle, 'SFC block order preserved (script → template → style)');
  }
}

/* ── 3. comment-heavy template (would lose comments if parser dropped them) ── */
{
  const src = `<ul>\n<!-- first -->\n<li>a</li>\n<!-- second -->\n<li>b</li>\n</ul>`;
  const f1 = await fmt(src, 't.html');
  ok((f1.match(/<!--/g) || []).length === 2, 'all comments survive a comment-heavy template');
}

/* ── 4. plain HTML NOT routed to weave is left to Prettier's own HTML formatter ── */
{
  const html = `<div><p>hi</p></div>`;
  const f = await prettier.format(html, { parser: 'html' });
  ok(!f.includes('weave'), 'plain HTML via parser:"html" is unaffected by the plugin');
}

console.log(failures ? `\n✖ ${failures} check(s) failed\n` : '\n✓ all checks passed\n');
process.exit(failures ? 1 : 0);
