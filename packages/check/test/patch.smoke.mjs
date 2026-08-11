/**
 * Node smoke test for @weave-framework/check — RFC 0008 `#3`: the markup inside `export const patch`.
 *
 * A `#3` extension writes no template of its own, so `weave check` classified it as an ordinary module
 * and its patched markup was the one template Weave never checked: a typo in a patched expression
 * surfaced at build or run time instead of in the editor.
 *
 * What each assertion isolates:
 *   1. a typo in patched markup is an error, reported in the EXTENSION's own file;
 *   2. correct patched markup is silent (no false positives from checking it at all);
 *   3. a patched expression can read the BASE's context — that is what the runtime gives it;
 *   4. and reading a base binding that does not exist is still an error;
 *   5. a patch is checked IN PLACE: it sees the template locals of the block it lands in;
 *   6. an error in the base's own markup is NOT re-reported against the extension;
 *   7. the location is the character that is wrong, not the top of the file;
 *   8. `attr` ops are checked too, offsets and all;
 *   9. a selector matching nothing is reported rather than swallowed.
 *
 * Run: `node packages/check/test/patch.smoke.mjs` (wired into verify:check).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'check-for-patch-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'check', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript'],
  outfile: out,
});
const { checkProject } = await import(pathToFileURL(out).href);

console.log('\npackages/check/test/patch.smoke.mjs');

/**
 * A base list component (`items` from setup, a `@for` over it) plus an extension that patches it.
 * `baseHtml` is overridable so the base's OWN markup can be broken independently of the patch.
 */
function check(patchSrc, { baseHtml, extraSetup = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-patch-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'list.ts'),
    // Signals, since that is what a real base exposes — a `Signal<T>` IS `() => T`, and typing them as
    // plain values made `{{ title() }}` "not callable" and looked like a defect in the checking.
    'export function setup(): { items: () => string[]; title: () => string } {\n' +
      "  return { items: () => ['a'], title: () => 'List' };\n" +
      '}\n'
  );
  writeFileSync(
    join(dir, 'app', 'list.html'),
    baseHtml ?? '<ul class="list">\n  @for (item of items()) {\n    <li>{{ item }}</li>\n  }\n</ul>\n'
  );
  // The comment is load-bearing: it sits BEFORE the patch array, so if comments were stripped rather
  // than blanked in place, every offset after it — every reported line and column — would be wrong.
  writeFileSync(
    join(dir, 'app', 'fancy.ts'),
    "import List from './list';\n" +
      'export const extend = List;\n' +
      (extraSetup === 'auto-expose'
        ? 'export function setup() {\n  const pick = (_s: string): void => {};\n  void pick;\n}\n'
        : 'export function setup(): { pick: (s: string) => void } {\n' +
          '  const pick = (_s: string): void => {};\n' +
          '  return { pick };\n' +
          '}\n') +
      '/* a block comment\n   over two lines */\n' +
      '// and a line comment, both before the ops\n' +
      `export const patch = ${patchSrc};\n`
  );
  const diags = checkProject([dir]);
  const src = readFileSync(join(dir, 'app', 'fancy.ts'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { diags, src };
}

const inFancy = (diags) => diags.filter((d) => d.file.replace(/\\/g, '/').endsWith('/fancy.ts'));
const inList = (diags) => diags.filter((d) => /list\.(ts|html)$/.test(d.file.replace(/\\/g, '/')));

// 1 + 7. A typo inside patched markup errors, in the extension's file, at the offending character.
{
  const { diags, src } = check("[{ op: 'prepend', sel: '.list', html: '<h2>{{ titel() }}</h2>' }]");
  const mine = inFancy(diags);
  ok(mine.length > 0, 'a typo inside patched markup is an error');
  ok(
    mine.every((d) => /titel/.test(d.message)),
    `and it names the misspelling (got: ${mine.map((d) => d.message).join(' | ') || 'nothing'})`
  );
  // The reported line must be the one holding the markup, not line 1 of the file.
  const line = src.split('\n').findIndex((l) => l.includes('titel')) + 1;
  ok(
    mine.some((d) => d.line === line),
    `it is reported at the line the markup is written on (want ${line}, got ${mine.map((d) => d.line).join(',')})`
  );
  const col = (src.split('\n')[line - 1] ?? '').indexOf('titel') + 1;
  ok(
    mine.some((d) => Math.abs(d.col - col) <= 2),
    `and at the column of the expression itself (want ~${col}, got ${mine.map((d) => d.col).join(',')})`
  );
}

// 2 + 3. Correct patched markup reading the BASE's context is silent.
{
  const { diags } = check("[{ op: 'prepend', sel: '.list', html: '<h2>{{ title() }}</h2>' }]");
  ok(inFancy(diags).length === 0, `a patch reading a real base binding is silent (got: ${inFancy(diags).map((d) => d.message).join(' | ')})`);
}

// 4. …but a base binding that does not exist is still caught — the context is typed, not waved through.
{
  const { diags } = check("[{ op: 'prepend', sel: '.list', html: '<h2>{{ subtitle() }}</h2>' }]");
  ok(
    inFancy(diags).some((d) => /subtitle/.test(d.message)),
    'a patch reading a base binding that does not exist is an error'
  );
}

// 5. A patch lands INSIDE the base's `@for`, so it sees that block's local.
{
  const good = check("[{ op: 'append', sel: 'li', html: '<b>{{ item }}</b>' }]");
  ok(inFancy(good.diags).length === 0, `a patch inside a block reads that block's local (got: ${inFancy(good.diags).map((d) => d.message).join(' | ')})`);
  const bad = check("[{ op: 'append', sel: 'li', html: '<b>{{ itme }}</b>' }]");
  ok(inFancy(bad.diags).some((d) => /itme/.test(d.message)), 'and a typo of that local is still caught');
}

// 6. An error in the BASE's own markup belongs to the base — reported once, there, not against the extension.
{
  const { diags } = check("[{ op: 'prepend', sel: '.list', html: '<h2>{{ title() }}</h2>' }]", {
    baseHtml: '<ul class="list">\n  <li>{{ nosuch() }}</li>\n</ul>\n',
  });
  ok(inList(diags).some((d) => /nosuch/.test(d.message)), "the base's own error is reported against the base");
  ok(
    inFancy(diags).length === 0,
    `and NOT against the extension patching it (got: ${inFancy(diags).map((d) => `${d.file}:${d.line} ${d.message}`).join(' | ')})`
  );
}

// 8. `attr` ops carry markup too — the commonest patch there is.
{
  const { diags, src } = check("[{ op: 'attr', sel: 'li', attr: 'on:click={{ pick(item) }}' }]");
  ok(inFancy(diags).length === 0, `a correct attr patch is silent (got: ${inFancy(diags).map((d) => d.message).join(' | ')})`);
  const bad = check("[{ op: 'attr', sel: 'li', attr: 'on:click={{ pcik(item) }}' }]");
  const mine = inFancy(bad.diags);
  ok(mine.some((d) => /pcik/.test(d.message)), 'and a typo inside an attr patch is an error');
  const line = bad.src.split('\n').findIndex((l) => l.includes('pcik')) + 1;
  ok(mine.some((d) => d.line === line), `reported on the line it is written on (want ${line}, got ${mine.map((d) => d.line).join(',')})`);
  // An attr op is parsed by wrapping it in a dummy element, so its offsets carry that wrapper's width.
  // Without correcting for it the column is off by exactly `<w-patch `.length — right line, wrong place.
  const col = (bad.src.split('\n')[line - 1] ?? '').indexOf('pcik') + 1;
  ok(
    mine.some((d) => Math.abs(d.col - col) <= 2),
    `and at the column of the expression, corrected for the parse wrapper (want ~${col}, got ${mine.map((d) => d.col).join(',')})`
  );
  void src;
}

// 8b. An extension whose setup omits its `return` gets one synthesized — of ITS OWN bindings only.
// Auto-expose off the merged context would make the extension's setup claim to return the base's
// bindings, which it has no way to see: correct code, a wall of "Cannot find name".
{
  const { diags } = check("[{ op: 'prepend', sel: '.list', html: '<h2 on:click={{ pick }}>{{ title() }}</h2>' }]", {
    extraSetup: 'auto-expose',
  });
  ok(
    inFancy(diags).length === 0,
    `a setup with no return exposes only what it owns (got: ${inFancy(diags).map((d) => d.message).join(' | ')})`
  );
}

// 9. A selector matching nothing is a real defect: the patch silently does nothing at runtime.
{
  const { diags } = check("[{ op: 'prepend', sel: '.nope', html: '<b>x</b>' }]");
  ok(
    inFancy(diags).some((d) => /matched no element/.test(d.message)),
    `a selector matching nothing is reported (got: ${inFancy(diags).map((d) => d.message).join(' | ') || 'nothing'})`
  );
}

rmSync(out, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ patched markup is type-checked, in the extension that wrote it.');
