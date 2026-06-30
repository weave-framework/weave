import { test, assert } from '../../../tools/harness.js';
import { formatMessage } from '../src/icu.js';

/* ───────────────────────── interpolation ───────────────────────── */

test('icu: {{ name }} double-brace interpolation', () => {
  assert.equal(formatMessage('Hi {{ name }}!', { name: 'Aidas' }, 'en'), 'Hi Aidas!');
});

test('icu: { name } single-brace interpolation', () => {
  assert.equal(formatMessage('Hi {name}!', { name: 'Aidas' }, 'en'), 'Hi Aidas!');
});

test('icu: missing param interpolates to empty string', () => {
  assert.equal(formatMessage('Hi {{ name }}!', {}, 'en'), 'Hi !');
});

test('icu: a string with no placeholders is returned verbatim', () => {
  assert.equal(formatMessage('plain text', undefined, 'en'), 'plain text');
});

/* ───────────────────────── plural ───────────────────────── */

const CART: string = '{count, plural, =0 {empty} one {# item} other {# items}}';

test('icu: plural picks the =0 exact case', () => {
  assert.equal(formatMessage(CART, { count: 0 }, 'en'), 'empty');
});

test('icu: plural one category + # is the formatted number', () => {
  assert.equal(formatMessage(CART, { count: 1 }, 'en'), '1 item');
});

test('icu: plural other category', () => {
  assert.equal(formatMessage(CART, { count: 5 }, 'en'), '5 items');
});

test('icu: plural # uses locale number formatting (grouping)', () => {
  assert.equal(formatMessage(CART, { count: 1234 }, 'en'), '1,234 items');
});

test('icu: selectordinal (en ordinals)', () => {
  const ord: string = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
  assert.equal(formatMessage(ord, { n: 1 }, 'en'), '1st');
  assert.equal(formatMessage(ord, { n: 2 }, 'en'), '2nd');
  assert.equal(formatMessage(ord, { n: 3 }, 'en'), '3rd');
  assert.equal(formatMessage(ord, { n: 11 }, 'en'), '11th');
});

/* ───────────────────────── select ───────────────────────── */

test('icu: select branches on a string key', () => {
  const sel: string = '{g, select, male {he} female {she} other {they}}';
  assert.equal(formatMessage(sel, { g: 'female' }, 'en'), 'she');
  assert.equal(formatMessage(sel, { g: 'x' }, 'en'), 'they');
});

test('icu: a plural sub-message may nest {{ }} interpolation', () => {
  const msg: string = '{count, plural, one {{{ name }} has # message} other {{{ name }} has # messages}}';
  assert.equal(formatMessage(msg, { count: 1, name: 'Aidas' }, 'en'), 'Aidas has 1 message');
  assert.equal(formatMessage(msg, { count: 3, name: 'Aidas' }, 'en'), 'Aidas has 3 messages');
});

/* ───────────────────────── number / date ───────────────────────── */

test('icu: number plain + percent + integer', () => {
  assert.equal(formatMessage('{x, number}', { x: 1234.5 }, 'en'), '1,234.5');
  assert.equal(formatMessage('{x, number, percent}', { x: 0.5 }, 'en'), '50%');
  assert.equal(formatMessage('{x, number, integer}', { x: 3.7 }, 'en'), '4');
});

test('icu: date/time produce a non-empty localized string', () => {
  const d: Date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  assert.ok(formatMessage('{d, date, medium}', { d }, 'en').length > 0, 'date renders');
  assert.ok(formatMessage('{d, time, short}', { d }, 'en').length > 0, 'time renders');
});

/* ───────────────────────── escaping ───────────────────────── */

test("icu: '' is a literal apostrophe", () => {
  assert.equal(formatMessage("It''s {{ x }}", { x: 'ok' }, 'en'), "It's ok");
});

test("icu: '{' quotes a literal brace (not a placeholder)", () => {
  assert.equal(formatMessage("'{'not a tag'}'", {}, 'en'), '{not a tag}');
});
