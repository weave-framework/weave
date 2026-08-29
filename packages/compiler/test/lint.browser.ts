import { test, assert } from '../../../tools/harness.js';
import { lintTemplate, lintTemplateFindings, parseTemplate } from '@weave-framework/compiler';
import type { LintFinding, LintFix, TemplateNode } from '@weave-framework/compiler';

/*
 * The mistakes a first-time Weave author actually makes, every one of which used to compile clean and
 * fail silently at runtime. Measured on a scaffolded app before this lint existed:
 *
 *   <button onclick={{ inc }}>  → the attribute is set to the FUNCTION'S SOURCE TEXT, the button does
 *                                 nothing, and neither `weave check` nor `weave build` says a word.
 *   <b xyz:abc={{ x }}>         → an unknown prefix is emitted as a plain attribute, silently.
 *   <button on:clik={{ inc }}>  → a typo'd event name binds a listener nothing ever fires.
 *   @fro (t of todos()) { … }   → an unrecognised block is left in the page as literal text.
 *
 * The lint is deliberately narrow: it fires on what cannot be anything but a mistake. A static
 * `onclick="…"` is real HTML, `xlink:href` is a real namespace, and a genuinely custom event name is
 * someone's own — none of those may warn.
 */

const lint = (html: string): string[] => lintTemplate(parseTemplate(html) as TemplateNode[]);

test('a DOM event attribute bound with {{ }} is reported, with the on: form named', () => {
  const w: string[] = lint('<button onclick={{ inc }}>x</button>');
  assert.equal(w.length, 1, `one warning (got ${JSON.stringify(w)})`);
  assert.ok(w[0].includes('on:click'), `it names the fix (got ${w[0]})`);
});

test('a static event attribute is real HTML and stays silent', () => {
  assert.equal(lint('<button onclick="alert(1)">x</button>').length, 0, 'no warning');
});

test('an unknown binding prefix is reported', () => {
  const w: string[] = lint('<b xyz:abc={{ x }}>x</b>');
  assert.equal(w.length, 1, `one warning (got ${JSON.stringify(w)})`);
  assert.ok(w[0].includes('xyz:'), `it names the prefix (got ${w[0]})`);
});

test('an XML namespace attribute is not a binding prefix', () => {
  assert.equal(lint('<svg><use xlink:href={{ href }} /></svg>').length, 0, 'xlink is left alone');
});

test('a typo in an event name is reported with the nearest real event', () => {
  const w: string[] = lint('<button on:clik={{ inc }}>x</button>');
  assert.equal(w.length, 1, `one warning (got ${JSON.stringify(w)})`);
  assert.ok(w[0].includes('click'), `it suggests click (got ${w[0]})`);
});

test('an event name that is nobody else’s typo is left alone', () => {
  assert.equal(lint('<div on:cart-updated={{ onCart }}>x</div>').length, 0, 'a custom event is fine');
  assert.equal(lint('<div on:click={{ go }}>x</div>').length, 0, 'a real event is fine');
});

test('a misspelled block keyword is reported', () => {
  const w: string[] = lint('<div>@fro (t of todos()) { <i>x</i> }</div>');
  assert.equal(w.length, 1, `one warning (got ${JSON.stringify(w)})`);
  assert.ok(w[0].includes('@for'), `it suggests @for (got ${w[0]})`);
});

test('prose that merely looks like a block is left alone', () => {
  assert.equal(lint('<p>write @media (min-width: 40em) { … } in your stylesheet</p>').length, 0, 'no warning');
  assert.equal(lint('<p>mail @support (or @sales) today</p>').length, 0, 'no warning');
});

test('a correct template produces no warnings at all', () => {
  const w: string[] = lint(
    '<main class="app">' +
      '<button on:click={{ inc }} class:active={{ on() }}>{{ count() }}</button>' +
      '@for (t of todos()) { <li use:tip={{ t }} bind:value={{ t.name }}>{{ t.title }}</li> }' +
      '@if (ready()) { <b style:color={{ c() }}>ok</b> } @else { <i>…</i> }' +
      '</main>'
  );
  assert.equal(w.length, 0, `nothing to report (got ${JSON.stringify(w)})`);
});

/*
 * Structured findings (`lintTemplateFindings`) — the same rules, plus the position and, where exactly
 * one answer exists, the replacement. The gate that matters is not "a fix was offered" but "applying
 * it produces the correct source, byte for byte, and silences the rule". A fix that lands one
 * character off would still LOOK like a fix in a message-only assertion.
 */

const findings = (html: string): LintFinding[] => lintTemplateFindings(parseTemplate(html) as TemplateNode[]);

/** Apply every offered fix. Back to front, or an earlier edit shifts every later offset. */
const applyFixes = (src: string): string => {
  const fixes: LintFix[] = findings(src)
    .map((f) => f.fix)
    .filter((f): f is LintFix => f !== undefined)
    .sort((a, b) => b.start - a.start);
  let out: string = src;
  for (const f of fixes) out = out.slice(0, f.start) + f.text + out.slice(f.end);
  return out;
};

test('a typo’d event name carries a fix that lands exactly on the name', () => {
  const src: string = '<button on:clik={{ inc }}>x</button>';
  const f: LintFinding[] = findings(src);
  assert.equal(f.length, 1, 'one finding (got ' + JSON.stringify(f.map((x) => x.message)) + ')');
  assert.ok(f[0].fix !== undefined, 'it carries a fix');
  assert.equal(src.slice(f[0].fix.start, f[0].fix.end), 'clik', 'the range covers exactly the event name');
  assert.equal(applyFixes(src), '<button on:click={{ inc }}>x</button>', 'applying it yields the correct source');
});

test('an event bound as a plain attribute is fixed to the on: form', () => {
  const src: string = '<button onclick={{ inc }}>x</button>';
  assert.equal(applyFixes(src), '<button on:click={{ inc }}>x</button>', 'onclick becomes on:click');
});

test('a misspelled block is fixed to the block it meant', () => {
  const src: string = '<div>@fro (t of todos()) { <b>{{ t }}</b> }</div>';
  const f: LintFinding[] = findings(src);
  assert.ok(f[0].fix !== undefined, 'it carries a fix');
  assert.equal(src.slice(f[0].fix.start, f[0].fix.end), 'fro', 'the range covers the word, not the @');
  assert.equal(applyFixes(src), '<div>@for (t of todos()) { <b>{{ t }}</b> }</div>', 'applying it yields the correct source');
});

test('three mistakes in one template are all fixed, and the result lints clean', () => {
  const broken: string = '<div>@fro (t of ts()) { <button onclick={{ a }} on:clik={{ b }}>x</button> }</div>';
  const fixed: string = '<div>@for (t of ts()) { <button on:click={{ a }} on:click={{ b }}>x</button> }</div>';
  assert.equal(findings(broken).filter((f) => f.fix !== undefined).length, 3, 'three fixes offered');
  assert.equal(applyFixes(broken), fixed, 'all three applied back-to-front give exactly the fixed source');
  assert.equal(findings(fixed).length, 0, 'and the fixed source has nothing left to report');
});

test('a rule with more than one plausible answer offers NO fix', () => {
  const f: LintFinding[] = findings('<b xyz:abc={{ x }}>t</b>');
  assert.equal(f.length, 1, 'still reported');
  assert.equal(f[0].fix, undefined, 'but no fix is guessed');
});

test('a coalesced text run reports without a position rather than a wrong one', () => {
  // The comment is dropped, so the two text runs merge and an index into `value` no longer maps to
  // the source. The warning must survive; the position must not be invented.
  const f: LintFinding[] = findings('<div>x<!-- c -->@fro (a) { }</div>');
  assert.equal(f.length, 1, 'still reported (got ' + JSON.stringify(f) + ')');
  assert.equal(f[0].offset, undefined, 'no position');
  assert.equal(f[0].fix, undefined, 'and therefore no fix');
});

test('the original string-only API is unchanged', () => {
  const src: string = '<button on:clik={{ inc }}>x</button>';
  assert.equal(JSON.stringify(lintTemplate(parseTemplate(src) as TemplateNode[])), JSON.stringify(findings(src).map((f) => f.message)), 'lintTemplate is the message projection');
});
