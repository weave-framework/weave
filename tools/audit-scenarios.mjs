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
  { page: 'components', entries: [], sources: ['packages/compiler/src', 'packages/cli/src/plugin.ts'] },
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
      if (doc !== -1 && before.slice(doc).includes('@internal') && !before.slice(doc).includes('*/\n\n')) continue;
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
      const text = [...m[1].matchAll(/[`'"]([^`'"]{20,200})[`'"]/g)].map((x) => x[1]).join(' ').replace(/\s+/g, ' ').trim();
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
  const apiMissing = [...api].filter((n) => !words.has(n));

  const msgs = messagesIn(s.sources);
  // The probe is the longest run of literal words at the start, AFTER dropping the `weave:` / `Weave:`
  // prefix most messages carry. Splitting on the first colon made every one of those probe the single
  // word "weave", which is under the length floor, so a page quoting the message verbatim still counted
  // as not showing it.
  const probeOf = (m) =>
    m
      .replace(/^\s*\[?weave\]?:\s*/i, '')
      .replace(/\$\{[^}]*\}/g, '…')
      .split(/[.,—]|…/)[0]
      .trim()
      .slice(0, 34);
  const shown = msgs.filter((m) => {
    const probe = probeOf(m);
    return probe.length > 12 && text.includes(probe);
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
