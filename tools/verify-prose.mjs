/**
 * Gate: the docs may only name things that exist, and may only say them one way.
 *
 * Four passes, one failure shape between them. A name that does not resolve produces ABSENCE, and
 * absence is the single thing a reader cannot notice is missing — every instance below was found by
 * eye, late, by accident, and each had been sitting in the tree for months.
 *
 *   1. SPELLING. 80 American spellings against 35 British ones across 145 files: `sanitised` five
 *      times on the Icon pages while `sanitizes` stood in the CHANGELOG, `organised` and `organized`
 *      inside one document. No single file was wrong, which is why nobody editing one page could see
 *      it. Only words with both spellings are listed — `advise`, `promise` and `analysis` have no
 *      `-ize` form, and a check that flags those teaches people to ignore it.
 *
 *   2. CALLOUT KINDS. `:::callout note` appeared three times; `note` is not a kind, so it fell back
 *      to `info` and drew an ordinary box. Three authors got a flavor they never asked for.
 *
 *   3. ICON NAMES. `<Icon name="more-vertical">` on the Toolbar pages: Lucide renamed that glyph, so
 *      the registry resolved nothing and a button labelled "More" rendered with no picture in it.
 *
 *   4. SYMBOLS TYPED AS CHARACTERS. `Get started →` on the landing page, `[Next: … →](…)` closing
 *      every Learn page. The house rule is that a symbol is drawn with `<Icon>`, never a Unicode
 *      glyph and never CSS.
 *
 * Each pass reads its ground truth from the thing that renders — the callout component, the icon set —
 * rather than a list kept here, because a hand-kept copy is the next thing to drift. Each refuses to
 * run if it cannot find that ground truth, so none can pass vacuously. All four are proven by
 * mutation, not trusted for being green.
 *
 * Run: `node tools/verify-prose.mjs` (wired into `pnpm verify:prose`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/* British → American, for words where both spellings are real. */
const PAIRS = [
  ['customise', 'customize'],
  ['sanitise', 'sanitize'],
  ['summarise', 'summarize'],
  ['memorise', 'memorize'],
  ['organise', 'organize'],
  ['organisation', 'organization'],
  ['normalise', 'normalize'],
  ['normalisation', 'normalization'],
  ['recognise', 'recognize'],
  ['serialise', 'serialize'],
  ['serialisation', 'serialization'],
  ['localise', 'localize'],
  ['parameterise', 'parameterize'],
  ['stabilise', 'stabilize'],
  ['optimise', 'optimize'],
  ['optimisation', 'optimization'],
  ['initialise', 'initialize'],
  ['synthesise', 'synthesize'],
  ['prioritise', 'prioritize'],
  ['capitalise', 'capitalize'],
  ['specialise', 'specialize'],
  ['authorisation', 'authorization'],
  ['minimise', 'minimize'],
  ['maximise', 'maximize'],
  ['visualise', 'visualize'],
  ['categorise', 'categorize'],
];

/* Each stem, in every inflection prose actually uses. */
const FORMS = ['', 's', 'd', 'ing'];
const RULES = PAIRS.flatMap(([bad, good]) =>
  FORMS.map((suffix) => {
    const from = suffix === 'ing' ? bad.replace(/e$/, '') + suffix : bad + suffix;
    const to = suffix === 'ing' ? good.replace(/e$/, '') + suffix : good + suffix;
    return { re: new RegExp(`\\b(${from})\\b`, 'gi'), to };
  })
);

// `skills/` is here because the copy under packages/create-weave/template is GENERATED from it by
// tools/sync-skills.mjs. Both British spellings this gate found were fixed in that copy and left in
// the source, so the next build wrote them straight back — the gate passed twice in between. A
// corpus that holds a generated file and not its input measures the wrong thing.
const ROOTS = ['docs/src/content', 'README.md', 'CHANGELOG.md', 'RELEASE-NOTES.md', 'ROADMAP.md', 'TODO.md', 'packages', 'skills'];
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.md')) files.push(f);
  }
};
for (const r of ROOTS) {
  const st = statSync(r, { throwIfNoEntry: false });
  if (!st) continue;
  if (st.isDirectory()) walk(r);
  else files.push(r);
}

if (files.length < 100) {
  console.error(`\n✖ only ${files.length} markdown files found — the scan is looking in the wrong place.\n`);
  process.exit(1);
}

const hits = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const { re, to } of RULES) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          hits.push({ file: f.split(sep).join('/'), line: i + 1, found: m[1], want: to });
        }
      }
    });
}

/* ── Pass 2: every `:::callout <kind>` must be a kind the component actually renders. ──
   `:::callout note` was written three times. `note` is not a kind, so it fell back to `info` and
   rendered as a perfectly ordinary info box — nothing was broken, nothing was reported, and the author
   got a flavor they did not ask for. Ground truth is the ICONS map in the component, not a list here. */
const CALLOUT = 'docs/src/lib/callout/callout.ts';
const known = new Set(
  [...(readFileSync(CALLOUT, 'utf8').match(/const ICONS[^}]*}/s)?.[0] ?? '').matchAll(/^\s*([a-z]+):\s*'/gm)].map((m) => m[1])
);
if (known.size < 3) {
  console.error(`\n✖ could not read the callout kinds from ${CALLOUT} — this pass would pass vacuously.\n`);
  process.exit(1);
}
const badKinds = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const m = /^:::callout\s+([a-z-]+)/.exec(line);
      if (m && !known.has(m[1])) badKinds.push({ file: f.split(sep).join('/'), line: i + 1, kind: m[1] });
    });
}

console.log(`\ntools/verify-prose.mjs — ${files.length} public markdown files, ${RULES.length} spellings, ${known.size} callout kinds`);

if (badKinds.length) {
  console.error(`\n✖ callout kinds the docs use but the component does not render (${badKinds.length}):\n`);
  for (const b of badKinds) console.error(`  ${b.file}:${b.line}  "${b.kind}" — known: ${[...known].join(', ')}`);
  console.error('');
  process.exit(1);
}

/* ── Pass 3: every icon the docs name must be one the registry can actually resolve. ──
   `<Icon name="more-vertical">` sat on the Toolbar pages. Lucide renamed that glyph to
   `ellipsis-vertical`, so the registry returned nothing and the component rendered an empty <svg>: a
   button labelled "More" with no picture in it, on a page whose subject is that toolbar. Same failure
   shape as the token and callout ones — a name that does not resolve produces absence, and absence is
   the one thing a reader cannot notice is missing. The docs register no extra icon sources, so the
   built-in set is the whole ground truth here. */
const ICON_SET = 'packages/ui/src/icon/lucide-icons.ts';
const iconNames = new Set([...readFileSync(ICON_SET, 'utf8').matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map((m) => m[1]));
if (iconNames.size < 20) {
  console.error(`\n✖ could not read the icon set from ${ICON_SET} — this pass would pass vacuously.\n`);
  process.exit(1);
}
const docSrc = [];
const walkSrc = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) walkSrc(f);
    else if (/\.(md|html)$/.test(e.name)) docSrc.push(f);
  }
};
walkSrc('docs/src');
const badIcons = [];
for (const f of docSrc) {
  readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const names = [
        ...[...line.matchAll(/:icon\[([a-z0-9-]+)\]/g)].map((m) => m[1]),
        ...[...line.matchAll(/<Icon[^>]*\bname=\{\{\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
      ];
      for (const n of names) {
        if (!iconNames.has(n)) badIcons.push({ file: f.split(sep).join('/'), line: i + 1, name: n });
      }
    });
}
if (badIcons.length) {
  console.error(`\n✖ icons the docs name that the built-in set does not have (${badIcons.length}) — each renders as nothing:\n`);
  for (const b of badIcons) console.error(`  ${b.file}:${b.line}  "${b.name}"`);
  console.error('');
  process.exit(1);
}

console.log(`  ${iconNames.size} built-in icons, ${docSrc.length} docs source files scanned for icon names`);

/* ── Pass 4: an arrow the reader CLICKS must be an icon, never a typed character. ──
   The landing page said `Get started →` and `Live demo ↗`, and every Learn page ended in
   `[Next: … →](…)`. The house rule is that a symbol is drawn with `<Icon>` — never a Unicode glyph,
   never CSS — and 28 link labels plus 4 templates had quietly opted out. The markdown ones had a
   reason: link text could not contain `:icon[…]` until the parser learned nested brackets, so the
   character was the only thing that parsed. The reason is gone, so the exemption is too.

   Scoped to where a glyph is an AFFORDANCE. `asc → desc → none` in a sentence, `// read → 0` in a
   comment, and an arrow inside a code fence are notation — an <svg> cannot go in any of them, and a
   check that flags all 295 of those is a check somebody switches off. Measured before scoping. */
const rendered = files.filter((f) => f.split(sep).join('/').startsWith('docs/src/content'));
const AFFORDANCE = [
  { what: 'a docs template', files: docSrc.filter((f) => f.endsWith('.html')), re: /[←-⇿➔-➿■-◿]/g },
  // Only the pages the docs site renders. README and CHANGELOG are read on GitHub, which has no
  // `:icon[]` — there a typed arrow is the only arrow available, so requiring an icon would be a rule
  // nobody could satisfy.
  // Both sides of a link. The trailing form (`… →](href)`) was the one this caught first; the LEADING
  // form (`… → [label](href)`) slipped past it and was still a typed arrow in a navigation list on three
  // Quick start lines, on /learn/tooling and on /ui/installation. Same affordance, other side.
  { what: 'a link label', files: rendered, re: /[←-⇿➔-➿]\s*\]\(/g },
  { what: 'a link lead-in', files: rendered, re: /[←-⇿➔-➿]\s*\[[^\]]*\]\(/g },
];
const drawn = [];
for (const { what, files: set, re } of AFFORDANCE) {
  for (const f of set) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) drawn.push({ file: f.split(sep).join('/'), line: i + 1, what, text: line.trim().slice(0, 90) });
      });
  }
}
if (drawn.length) {
  console.error(`\n✖ symbols typed as characters where an icon belongs (${drawn.length}):\n`);
  for (const d of drawn) console.error(`  ${d.file}:${d.line}  in ${d.what}\n      ${d.text}`);
  console.error(`\n  Use <Icon name={{ 'arrow-right' }} /> in a template, or :icon[arrow-right] in markdown.\n`);
  process.exit(1);
}

if (hits.length) {
  console.error(`\n✖ the public prose mixes spellings (${hits.length}); this corpus uses the American form:\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.found} → ${h.want}`);
  console.error('');
  process.exit(1);
}

console.log('✓ one spelling throughout\n');
