import { test, assert } from '../../../tools/harness.js';
import { lintTemplate, parseTemplate } from '@weave-framework/compiler';
import type { TemplateNode } from '@weave-framework/compiler';

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
