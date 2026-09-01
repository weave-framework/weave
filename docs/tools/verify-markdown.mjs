/**
 * Gate: every markdown page must render with no markup left over.
 *
 * A reader found this before any tool did. The Installation page's first callout published the literal
 * text `*`@weave-framework/**` scope (@weave-framework/runtime, @weave-framework/cli`, …)` — stray
 * asterisks, stray backticks, and code spans wrapped around the wrong words. The source was correct
 * markdown; the parser was not.
 *
 * Two causes, both since fixed in `parse.ts`:
 *
 *   - **Bold could not contain an asterisk.** `\*\*([^*]+)\*\*` excludes `*` from the content, so
 *     ``**`@weave-framework/*`**``, ``**`_layout.*` present**`` and ``**`*.html` routing**`` never
 *     matched as bold. The `*em*` alternative then matched from the first asterisk and produced
 *     garbage. `***bold italic***` failed the same way.
 *   - **A fence had to start at column 0.** Inside a numbered list a fenced block is indented, so on
 *     /learn/tooling three backticks and the `code --install-extension …` line under them rendered as
 *     literal text, twice.
 *
 * The check is the only one that could have caught these: parse each page with the REAL parser and
 * look for a marker that survived into rendered text. A regex about the parser would not do — the first
 * two attempts at this measurement over-counted by 70× and then by 500×, because a pattern matching
 * across two separate bold pairs "finds" a bug in correct markdown. Asking the parser is the only
 * honest question.
 *
 * Code-span CONTENT is excluded: a glob written inside backticks is something a reader is meant to see
 * verbatim, asterisks and all.
 *
 * Run: `node docs/tools/verify-markdown.mjs` (wired into `pnpm verify:markdown`).
 */
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const bundle = join(cacheDir, 'verify-markdown-parse.mjs');
await build({
  entryPoints: [join(repo, 'docs/src/lib/markdown/parse.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
});
const { parse } = await import(pathToFileURL(bundle).href);

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.md')) files.push(f);
  }
};
walk(join(repo, 'docs/src/content'));

if (files.length < 100) {
  console.error(`\n✖ only ${files.length} pages found — the scan is looking in the wrong place.\n`);
  process.exit(1);
}

/** Rendered TEXT of an inline run, skipping code spans (whose content is verbatim by design). */
function proseText(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.t === 'text') s += n.v;
    else if (n.t === 'code' || n.t === 'icon') continue;
    else s += proseText(n.c);
  }
  return s;
}

const LEFTOVER = /\*\*|`/;
const bad = [];
function scan(blocks, file) {
  for (const b of blocks) {
    // A tab group is verbatim INSIDE, but the group itself must have parsed. When the fence regex grew a
    // capture group, `parseTabs` kept reading the old indices, `marker` became the indent, and every tab
    // group on the site rendered as raw `~~~` text. This gate was green throughout, because it skipped
    // tabs entirely — a reader had to send a screenshot. So the group is checked even though its code is
    // not: it must contain at least one tab, and no tab's body may still hold a fence marker.
    if (b.type === 'tabs') {
      if (!b.tabs?.length) bad.push({ file, text: 'a :::tabs group parsed to zero tabs' });
      for (const t of b.tabs ?? []) {
        if (/^\s*(```|~~~)/m.test(t.code)) {
          bad.push({ file, text: `tab "${t.label}" still contains a fence marker — the group did not split` });
        }
      }
      continue;
    }
    if (b.type === 'code') continue; // verbatim by design
    if (b.children) scan(b.children, file);
    const runs = [];
    if (b.inline) runs.push(b.inline);
    if (b.items) runs.push(...b.items);
    if (b.header) runs.push(...b.header);
    if (b.rows) for (const r of b.rows) runs.push(...r);
    for (const run of runs) {
      const text = proseText(run);
      if (LEFTOVER.test(text)) bad.push({ file, text: text.trim().slice(0, 140) });
    }
  }
}
for (const f of files) scan(parse(readFileSync(f, 'utf8')), f.split(sep).join('/').replace(/.*\/docs\//, 'docs/'));


/*
 * A callout TITLE is markdown too — and for a year it was not rendered as any.
 *
 * `title` is a string prop set as text, so ``It works in `weave dev` `` published its own backticks. 34
 * titles on 25 pages did. The fix is a `title` slot the markdown renderer fills; both halves are checked
 * here, because either one alone silently restores the literal text.
 */
const titled = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^:::callout\s+\w+\s+"([^"]*)"/gm))
    if (/[`*_]/.test(m[1])) titled.push({ file: f.split(sep).join('/').replace(/.*\/docs\//, 'docs/'), title: m[1] });
}
if (titled.length) {
  const tpl = readFileSync('docs/src/lib/callout/callout.html', 'utf8');
  const render = readFileSync('docs/src/lib/markdown/render.ts', 'utf8');
  if (!/<slot\s+name="title"/.test(tpl))
    bad.push({ file: 'docs/src/lib/callout/callout.html', text: `no <slot name="title"> — the ${titled.length} formatted callout titles render their own markup as text` });
  if (!/title:\s*\(\):\s*DocumentFragment/.test(render))
    bad.push({ file: 'docs/src/lib/markdown/render.ts', text: `the callout is built without a title slot — the ${titled.length} formatted callout titles render their own markup as text` });
}

rmSync(bundle, { force: true });

console.log(`\ndocs/tools/verify-markdown.mjs — ${files.length} pages parsed with the real parser`);

if (bad.length) {
  console.error(`\n✖ markup that did not render (${bad.length}) — the reader sees these characters:\n`);
  for (const b of bad) console.error(`  ${b.file}\n      ${b.text}\n`);
  process.exit(1);
}

console.log('✓ every page renders with no markup left over\n');
