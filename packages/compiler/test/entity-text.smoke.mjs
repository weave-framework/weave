/**
 * Two rules about template TEXT that were silent, and both bit inside a day.
 *
 * 1. An HTML entity in a template is text, and the author almost never means that.
 * 2. A `{{ }}` inside <textarea> or <title> cannot work at all — those elements' content is RCDATA, so
 *    the `<!---->` marker the runtime writes there becomes six literal characters in the value. Found by
 *    a docs demo reading its own textarea back and parsing `[...rest].ts<!---->` as a filename.
 *
 * Weave templates are TEXT, not HTML: `escapeText` turns `&` into `&amp;` on the way into the emitted
 * `<template>` string. That is deliberate and load-bearing — it is what lets a template hold `<`, `{`
 * and a code sample without any of it being reinterpreted. The consequence is that `&mdash;` never
 * becomes an em dash. The browser prints the seven characters `&mdash;`.
 *
 * Nothing said so. I wrote ten of them into three demos in one afternoon, watched `effect ran 2&times;`
 * come back from my own browser measurement, and read straight past it. A reader spotted it.
 *
 * So the compiler warns, which reaches every app rather than only this repository. The rule is narrow in
 * the way the other lint rules are narrow: it fires on a NAMED entity that resolves to something other
 * than itself, which cannot plausibly be what an author typed on purpose. `&` alone, `&foo;`, and an
 * ampersand in prose ("Tall & scrolling") are all silent, because those are ordinary text.
 *
 * Run: `node packages/compiler/test/entity-text.smoke.mjs` (wired into `pnpm verify:entity-text`).
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  +' : '  X'} ${msg}`);
  if (!cond) failed++;
};

console.log('\npackages/compiler/test/entity-text.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-entity-text-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { parseTemplate, lintTemplateFindings } = await import(pathToFileURL(bundle).href);

const warnings = (tpl) => lintTemplateFindings(parseTemplate(tpl)).map((f) => f.message);
const about = (tpl, needle) => warnings(tpl).filter((m) => m.includes(needle));

/* ── What must warn ── */
for (const [tpl, ent] of [
  ['<p>a &mdash; b</p>', '&mdash;'],
  ['<span>ran 3&times;</span>', '&times;'],
  ['<p>&ldquo;quoted&rdquo;</p>', '&ldquo;'],
  ['<button>v =&gt; v + 1</button>', '&gt;'],
  ['<p>&#8212; numeric</p>', '&#8212;'],
  ['<p>&#x2014; hex</p>', '&#x2014;'],
]) {
  ok(about(tpl, ent).length === 1, `warns on ${ent} (got ${JSON.stringify(warnings(tpl))})`);
}

ok(
  (warnings('<p>a &mdash; b</p>')[0] ?? '').includes('—'),
  `the message shows the character to type instead (got ${JSON.stringify(warnings('<p>a &mdash; b</p>'))})`
);

/* ── What must stay silent, or the rule is noise ── */
for (const [what, tpl] of [
  ['a bare ampersand in prose', '<Button>Tall & scrolling</Button>'],
  ['an ampersand with a space', '<p>R&D budget & more</p>'],
  ['a made-up entity name', '<p>&notarealentity; here</p>'],
  ['an ampersand in an expression', '<p>{{ a && b }}</p>'],
  ['an ampersand in a URL attribute', '<a href="/x?a=1&b=2">link</a>'],
  ['an entity inside an expression, which IS JavaScript', '<p>{{ "&mdash;" }}</p>'],
]) {
  const w = warnings(tpl).filter((m) => m.includes('renders as text'));
  ok(w.length === 0, `${what} stays silent (got ${JSON.stringify(w)})`);
}

/* ── The control: the linter is running at all. Without this, "no warnings" above would be
      indistinguishable from a linter that returns nothing. ── */
ok(
  warnings('<button on:clik={{ go }}>x</button>').length === 1,
  'the linter itself still fires on a known mistake (control)'
);

/* ── RCDATA: a marker cannot live inside text-only content ── */
for (const [tpl, tag] of [
  ['<textarea>{{ draft() }}</textarea>', 'textarea'],
  ['<title>{{ name() }}</title>', 'title'],
]) {
  const w = warnings(tpl).filter((m) => m.includes(`inside <${tag}>`));
  ok(w.length === 1, `warns on an interpolation inside <${tag}> (got ${JSON.stringify(warnings(tpl))})`);
}
ok(
  warnings('<textarea>{{ draft() }}</textarea>')[0].includes('bind:value'),
  'and points a textarea at the form that does work'
);

/* ── and stays quiet where the markup is fine ── */
for (const [what, tpl] of [
  ['a textarea bound the right way', '<textarea bind:value={{ draft }}></textarea>'],
  ['a textarea with static text', '<textarea>plain text</textarea>'],
  ['an interpolation anywhere else', '<div>{{ x() }}</div>'],
]) {
  const w = warnings(tpl).filter((m) => m.includes('cannot update'));
  ok(w.length === 0, `${what} stays silent (got ${JSON.stringify(w)})`);
}

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`entity-text smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('entity-text smoke passed\n');
