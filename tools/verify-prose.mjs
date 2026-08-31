/**
 * Gate: the public prose spells things one way.
 *
 * Why this exists: a survey of 145 public markdown files found 80 American spellings and 35 British
 * ones — `sanitised` five times on the Icon pages while `sanitizes` stood in the CHANGELOG, `organised`
 * and `organized` inside one document. Nothing was wrong in any single file, which is exactly why it
 * lasted: an inconsistency spread thin over a corpus is invisible to whoever is editing one page.
 *
 * It was found only because a rewrite happened to add one more `organised` and someone asked whether
 * that matched. That is not a process. So the majority won by count, the 35 were rewritten, and this
 * keeps it that way — the next `normalises` fails here rather than surviving for a year.
 *
 * Only words that genuinely have BOTH spellings are listed. `advise`, `revise`, `promise`, `analysis`
 * and `optimistic` have no `-ize` form, and a check that flags those teaches people to ignore it.
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

const ROOTS = ['docs/src/content', 'README.md', 'CHANGELOG.md', 'RELEASE-NOTES.md', 'ROADMAP.md', 'TODO.md', 'packages'];
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

if (hits.length) {
  console.error(`\n✖ the public prose mixes spellings (${hits.length}); this corpus uses the American form:\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.found} → ${h.want}`);
  console.error('');
  process.exit(1);
}

console.log('✓ one spelling throughout\n');
