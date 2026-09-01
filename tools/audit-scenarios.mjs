/**
 * Is a reader prepared for what they will actually meet?
 *
 * The coverage audit asks whether an export is NAMED somewhere. That is a low bar, and passing it is
 * how a page ends up describing a happy path in four thousand words and carrying one warning at the
 * end. This asks the other question, per subsystem:
 *
 *   API      — every export the subsystem publishes, and whether its Learn page names it. A reference
 *              entry is not enough here: the reference answers "what is the signature", and this asks
 *              "would I know this exists".
 *   ERRORS   — every message the subsystem can put in front of an author, and whether any page shows it.
 *              Filtered to the ones a USER can cause: an internal invariant ("emit bug", "cursor off
 *              DOM") is not a scenario, it is a crash report.
 *   SHAPE    — does the page have the four sections every page is meant to have: what it is, something
 *              live, the scenarios, and what to do when it breaks.
 *
 * Read-only. Run: `node tools/audit-scenarios.mjs [page]`
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';

/**
 * Learn page → the source it documents.
 *
 * Mapped to MODULE FILES, not to a package barrel. The first version pointed `reactivity` at
 * `runtime/src/index.ts` and duly reported that the page never names `fade`, `provide` and
 * `mountDevtoolsPanel` — which is true and meaningless, because those belong to Motion, to Lifecycle and
 * to Tooling. An audit that attributes another page's API to this one produces a work list of phantoms.
 */
const SUBSYSTEMS = [
  { page: 'signals', entries: ['packages/runtime/src/reactive.ts'], sources: ['packages/runtime/src/reactive.ts'] },
  { page: 'reactivity', entries: ['packages/runtime/src/reactive.ts', 'packages/runtime/src/extras.ts'], sources: ['packages/runtime/src/reactive.ts', 'packages/runtime/src/extras.ts'] },
  // The COMPONENT sources only. Pointing this at all of `compiler/src` gave it the template parser's
  // messages too, so 38 parser errors were reported as missing from Components while Templates — whose
  // subject they are — quotes sixteen of them.
  { page: 'components', entries: [], sources: ['packages/compiler/src/sources.ts', 'packages/compiler/src/component.ts', 'packages/cli/src/plugin.ts'] },
  { page: 'templates', entries: [], sources: ['packages/compiler/src/parser.ts', 'packages/compiler/src/codegen.ts'] },
  { page: 'styling', entries: [], sources: ['packages/compiler/src/styles.ts'] },
  { page: 'lifecycle-context-di', entries: ['packages/runtime/src/context.ts'], sources: ['packages/runtime/src/context.ts'] },
  { page: 'router', entries: ['packages/router/src/index.ts'], sources: ['packages/router/src/index.ts'] },
  { page: 'store', entries: ['packages/store/src/index.ts'], sources: ['packages/store/src'] },
  { page: 'forms', entries: ['packages/forms/src/index.ts', 'packages/forms/src/dom.ts'], sources: ['packages/forms/src'] },
  { page: 'i18n', entries: ['packages/i18n/src/index.ts'], sources: ['packages/i18n/src'] },
  { page: 'motion', entries: ['packages/runtime/src/transitions.ts'], sources: ['packages/runtime/src/transitions.ts'] },
  { page: 'static-generation', entries: ['packages/runtime/src/server.ts', 'packages/runtime/src/resume.ts'], sources: ['packages/runtime/src/server.ts', 'packages/runtime/src/resume.ts'] },
  { page: 'tooling', entries: ['packages/runtime/src/devtools.ts'], sources: ['packages/cli/src/cli.ts', 'packages/runtime/src/dev-states.ts'] },
];

/** A message an AUTHOR can cause, as opposed to an invariant that means the framework broke. */
const INTERNAL = /emit bug|cursor off|unbalanced|not captured|handled in emitChildren|Empty template fragment|cannot be a single dynamic node/i;

function filesUnder(p) {
  if (!existsSync(p)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.ts') && !e.name.includes('.browser.')) out.push(f);
    }
  };
  try {
    readdirSync(p);
    walk(p);
  } catch {
    out.push(p); // a single file
  }
  return out;
}

function exportsOf(entry) {
  const names = new Set();
  const seen = new Set();
  (function walk(f) {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*'([^']+)')?/g))
      for (const part of m[1].split(',')) {
        const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
        if (n && /^[A-Za-z_$]/.test(n)) names.add(n);
      }
    for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      const doc = before.lastIndexOf('/**');
      // `@internal` counts when it sits in the doc block that ends immediately before this declaration.
      // The old test rejected any block containing a blank line, which is most real doc comments; what
      // actually matters is that nothing but whitespace separates the comment from the declaration.
      const tail = before.slice(before.lastIndexOf('*/') + 2);
      if (doc !== -1 && before.slice(doc).includes('@internal') && tail.trim() === '') continue;
      names.add(m[1]);
    }
    for (const m of src.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) walk(join(dirname(f), m[1].replace(/\.js$/, '') + '.ts'));
  })(entry);
  return names;
}

function messagesIn(paths) {
  const out = [];
  for (const f of paths.flatMap(filesUnder)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:throw new (?:Error|ParseError|TypeError)|console\.(?:error|warn))\(([\s\S]{0,320}?)\);/g)) {
      // A backtick inside a template literal is written `\``, and that backslash survived into the
      // extracted text — so a page quoting the message with real backticks never matched. Unescape it.
      const text = [...m[1].matchAll(/[`'"]([^`'"]{20,200})[`'"]/g)]
        .map((x) => x[1])
        .join(' ')
        .replace(/\`/g, '`')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || INTERNAL.test(text)) continue;
      out.push(text);
    }
  }
  return [...new Set(out)];
}

const SECTIONS = [
  { name: 'live demo', re: /^:::demo /m },
  { name: 'what you should see', re: /:::callout see/ },
  { name: 'a trap named', re: /:::callout trap/ },
  { name: 'when it goes wrong', re: /^#+ .*(goes wrong|what can go wrong|errors)/im },
];

/** Every word in the whole Learn section — the corpus a reader actually moves through. */
const learnWords = new Set();
for (const f of readdirSync('docs/src/content/learn')) {
  if (f.endsWith('.md')) for (const t of readFileSync(join('docs/src/content/learn', f), 'utf8').split(/[^A-Za-z0-9_$]+/)) learnWords.add(t);
}

const learnFlat = readdirSync('docs/src/content/learn')
  .filter((f) => f.endsWith('.md'))
  .map((f) => readFileSync(join('docs/src/content/learn', f), 'utf8'))
  .join(' ')
  .replace(/\s+/g, ' ');

const only = process.argv[2];
let totalApi = 0, totalErr = 0;
console.log('\npage                  API named        errors shown     page shape');
console.log('─'.repeat(78));
for (const s of SUBSYSTEMS) {
  if (only && s.page !== only) continue;
  const file = `docs/src/content/learn/${s.page}.md`;
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const words = new Set(text.split(/[^A-Za-z0-9_$]+/));

  const api = new Set();
  for (const e of s.entries) for (const n of exportsOf(e)) api.add(n);
  // Named on THIS page, or anywhere in Learn. `onMount`, `batch` and `root` all live in `reactive.ts`
  // and are taught on Lifecycle and Reactivity — asking only about the page a module maps to reported
  // twelve gaps on the Signals intro for API that is thoroughly documented one page over. The question
  // a reader has is "would I ever meet this", and Learn is the unit that answers it.
  const apiMissing = [...api].filter((n) => !words.has(n) && !learnWords.has(n));

  const msgs = messagesIn(s.sources);
  // A message counts as SHOWN when any literal run of it appears on the page.
  //
  // Two earlier versions were both wrong in the same direction — they picked ONE run and asked about
  // that. Leading-run probing failed on `Unclosed <${closeTag}>`, whose literal head is too short to
  // test; longest-run probing failed where a page quotes a message's first half and not its longest.
  // A message is a sentence with holes in it, so the honest question is whether the page shows any of
  // the parts between the holes.
  const runsOf = (m) =>
    m
      .replace(/^\s*\[?weave\]?:\s*/i, '')
      // Split on the holes AND on a stray backslash: an escaped backtick inside a template literal ends
      // the extractor's char class, leaving a lone `\` where `\`component\`` was. A run carrying that
      // matches nothing, and it was swallowing the whole message as one unusable run.
      .split(/\$\{[^}]*\}|\\n|\\/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter((part) => part.length >= 14);
  // Both sides get their whitespace collapsed. A page wraps a quoted message across lines, so a run that
  // is one string in the source is a string with a newline in it on the page — and `includes` said no to
  // messages the page quotes in full.
  const flat = text.replace(/\s+/g, ' ');
  // Shown on this page, or anywhere in Learn — the same reasoning as the API column. A reader who meets
  // `Unexpected @else` and finds it on Templates has been served, whichever page the audit files it under.
  const shown = msgs.filter((m) => {
    const runs = runsOf(m);
    return runs.length > 0 && runs.some((r) => flat.includes(r) || learnFlat.includes(r));
  });

  const shape = SECTIONS.filter((x) => x.re.test(text)).length;
  totalApi += apiMissing.length;
  totalErr += msgs.length - shown.length;
  const apiCell = api.size ? `${api.size - apiMissing.length}/${api.size}` : '—';
  console.log(
    `${s.page.padEnd(22)}${apiCell.padEnd(17)}${`${shown.length}/${msgs.length}`.padEnd(17)}${shape}/4 ${SECTIONS.filter((x) => !x.re.test(text)).map((x) => x.name).join(', ')}`
  );
  if (only) {
    if (apiMissing.length) console.log(`\n  API the page never names (${apiMissing.length}):\n    ${apiMissing.join(', ')}`);
    const hidden = msgs.filter((m) => !shown.includes(m));
    if (hidden.length) {
      console.log(`\n  messages a user can hit that the page never shows (${hidden.length}):`);
      for (const m of hidden.slice(0, 20)) console.log(`    ${m.slice(0, 104)}`);
    }
  }
}
if (!only) console.log(`\n${totalApi} unnamed export(s) · ${totalErr} unshown message(s) across the Learn pages\n`);
