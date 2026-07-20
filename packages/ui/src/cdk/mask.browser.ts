import { test, assert } from '../../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, signal, type Owner, type Signal } from '@weave-framework/runtime';
import { compileMask, mask, matchesMask, type CompiledMask, type MaskResult } from '@weave-framework/ui/cdk';

const PHONE: string = '(999) 999-9999';

/** Run `fn` and return the error message it threw, or `''` if it did not throw. */
function threw(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/* ─────────────────── the pure core ─────────────────── */

test('format: literals are emitted and unfilled positions become placeholders', () => {
  const m: CompiledMask = compileMask(PHONE);
  assert.equal(m.format('').display, '(___) ___-____');
  assert.equal(m.format('370').display, '(370) ___-____');
  assert.equal(m.format('3706001234').display, '(370) 600-1234');
});

test('format: the model holds only accepted characters, never literals or placeholders', () => {
  const r: MaskResult = compileMask(PHONE).format('370600');
  assert.equal(r.display, '(370) 600-____');
  assert.equal(r.model, '370600');
  assert.equal(r.complete, false);
});

test('format: complete is true only when every token position is filled', () => {
  const m: CompiledMask = compileMask(PHONE);
  assert.equal(m.format('370600123').complete, false);
  assert.equal(m.format('3706001234').complete, true);
});

test('format: characters a position cannot hold are dropped, not stalled on', () => {
  // Letters cannot enter a `9` slot; the digits after them still land.
  assert.equal(compileMask(PHONE).format('ab370').display, '(370) ___-____');
});

test('format: overflow past the last token position is discarded', () => {
  assert.equal(compileMask('999').format('123456').model, '123');
});

test('extract: a fully formatted string round-trips to its data characters', () => {
  const m: CompiledMask = compileMask(PHONE);
  assert.equal(m.extract('(370) 600-1234'), '3706001234');
});

test('extract: a paste of bare digits lands correctly despite the literals', () => {
  assert.equal(compileMask(PHONE).extract('3706001234'), '3706001234');
});

test('extract: placeholders consume a position without contributing data', () => {
  assert.equal(compileMask(PHONE).extract('(370) 12_-____'), '37012');
});

test('extract: a mixed paste keeps its own separators', () => {
  assert.equal(compileMask('9999-9999').extract('1234-5678'), '12345678');
});

/* ─────────────────── the template alphabet ─────────────────── */

test('alphabet: 9 takes digits, a takes letters, * takes either', () => {
  assert.equal(compileMask('9a*').format('1bC').model, '1bC');
});

test('alphabet: a character the position rejects is skipped, and the next one fills it', () => {
  // Not "the whole value is refused": the leading letter cannot open a `9` slot, so it is
  // dropped and the digit behind it lands there instead. This is the same rule that lets a
  // paste of "+370 600" survive its own punctuation.
  assert.equal(compileMask('9a*').format('a1C').model, '1C');
});

test('alphabet: a letter class accepts non-ASCII letters', () => {
  assert.equal(compileMask('aaa').format('ąčę').model, 'ąčę');
});

test('escape: a backslash makes the next template character a literal', () => {
  const m: CompiledMask = compileMask('AB-9999-\\a');
  assert.equal(m.format('1234').display, 'AB-1234-a', 'the escaped a is fixed text, not a slot');
  assert.equal(m.size, 4);
});

test('escape: a dangling escape is a template error, not a silent literal', () => {
  assert.ok(threw(() => compileMask('999\\')).includes('dangling'));
});

test('tokens: a caller token extends the alphabet', () => {
  const hex: CompiledMask = compileMask('HH:HH', { tokens: { H: (ch) => /[0-9a-f]/i.test(ch) } });
  assert.equal(hex.format('1a2B').display, '1a:2B');
  assert.equal(hex.format('zz').display, '__:__', 'non-hex is rejected');
});

test('tokens: redefining a builtin throws rather than shadowing it', () => {
  assert.ok(threw(() => compileMask('999', { tokens: { 9: () => true } })).includes('builtin'));
  assert.ok(threw(() => compileMask('999', { tokens: { '\\': () => true } })).includes('builtin'));
});

test('placeholder: the unfilled character is configurable', () => {
  assert.equal(compileMask('999', { placeholder: '#' }).format('1').display, '1##');
});

/* ─────────────────── caret arithmetic ─────────────────── */

test('caretAfter: zero data characters puts the caret at the first token position', () => {
  assert.equal(compileMask(PHONE).caretAfter(0), 1, 'past the opening bracket');
});

test('caretAfter: the caret steps over literals on its own', () => {
  const m: CompiledMask = compileMask(PHONE);
  assert.equal(m.caretAfter(3), 6, 'after "(370) " — past the bracket AND the space');
  assert.equal(m.caretAfter(6), 10, 'past the dash');
});

test('caretAfter: a full value puts the caret at the end', () => {
  assert.equal(compileMask(PHONE).caretAfter(10), PHONE.length);
});

/* ─────────────────── the validator ─────────────────── */

test('matchesMask: an incomplete value is reported, a complete one is not', () => {
  const v: (value: string) => string | null = matchesMask(PHONE);
  assert.equal(v('(370) 600-1234'), null);
  assert.equal(v('(370) 600-12__'), 'Incomplete');
});

test('matchesMask: emptiness is left to required, not claimed by the mask', () => {
  assert.equal(matchesMask(PHONE)(''), null);
});

test('matchesMask: the message is caller-supplied', () => {
  assert.equal(matchesMask(PHONE, { message: 'Neužbaigta' })('37'), 'Neužbaigta');
});

/* ─────────────────── the use: action ─────────────────── */

function mountInput(): { el: HTMLInputElement; owner: Owner; value: Signal<string> } {
  const el: HTMLInputElement = document.createElement('input');
  document.body.appendChild(el);
  const value: Signal<string> = signal<string>('');
  const owner: Owner = createOwner();
  runInOwner(owner, () => mask(el, { value, template: PHONE }));
  return { el, owner, value };
}

function teardown(el: HTMLInputElement, owner: Owner): void {
  disposeOwner(owner);
  el.remove();
}

/** Simulate the user having typed: the browser has already mutated value + caret. */
function type(el: HTMLInputElement, next: string, caret: number): void {
  el.value = next;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

test('action: typing digits formats them and skips the literals', () => {
  const { el, owner, value } = mountInput();
  type(el, '3', 1);
  assert.equal(el.value, '(3__) ___-____');
  assert.equal(value(), '3');
  type(el, '(37__) ___-____', 3);
  assert.equal(el.value, '(37_) ___-____');
  assert.equal(value(), '37');
  teardown(el, owner);
});

test('action: the caret lands past the literals, not on them', () => {
  const { el, owner } = mountInput();
  type(el, '370', 3);
  assert.equal(el.value, '(370) ___-____');
  assert.equal(el.selectionStart, 6, 'after the bracket and the space, ready for the 4th digit');
  teardown(el, owner);
});

test('action: a rejected character leaves value and caret untouched', () => {
  const { el, owner, value } = mountInput();
  type(el, '370', 3);
  const before: string = el.value;
  const caretBefore: number | null = el.selectionStart;
  type(el, '(370x) ___-____', 5); // a letter into a digit slot
  assert.equal(el.value, before);
  assert.equal(el.selectionStart, caretBefore);
  assert.equal(value(), '370');
  teardown(el, owner);
});

test('action: pasting a formatted number is re-masked, not doubled', () => {
  const { el, owner, value } = mountInput();
  type(el, '(370) 600-1234', 14);
  assert.equal(el.value, '(370) 600-1234');
  assert.equal(value(), '3706001234');
  teardown(el, owner);
});

test('action: pasting bare digits formats them', () => {
  const { el, owner, value } = mountInput();
  type(el, '3706001234', 10);
  assert.equal(el.value, '(370) 600-1234');
  assert.equal(value(), '3706001234');
  teardown(el, owner);
});

test('action: an edit in the middle keeps the caret on the same model character', () => {
  const { el, owner, value } = mountInput();
  type(el, '3706001234', 10);
  // Insert a 9 after the third digit: "(3709) 600-123" once re-masked.
  type(el, '(3709) 600-1234', 5);
  assert.equal(value(), '3709600123', 'the 9 landed 4th; the overflow digit fell off the end');
  assert.equal(el.selectionStart, 7, 'caret sits after the inserted 4th character, not back at the start');
  teardown(el, owner);
});

test('action: backspace over a literal deletes the data character, not the literal', () => {
  const { el, owner, value } = mountInput();
  type(el, '370', 3);
  assert.equal(el.value, '(370) ___-____');
  // The caret is at 6 — immediately after ") ", i.e. two literals past the last digit.
  el.setSelectionRange(6, 6);
  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  assert.equal(value(), '37', 'the 0 went, not the space');
  assert.equal(el.value, '(37_) ___-____');
  teardown(el, owner);
});

test('action: backspace on an empty value is a no-op, not an error', () => {
  const { el, owner, value } = mountInput();
  el.setSelectionRange(0, 0);
  el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  assert.equal(value(), '');
  teardown(el, owner);
});

test('action: an empty model shows an empty input, not a wall of underscores', () => {
  const { el, owner, value } = mountInput();
  assert.equal(el.value, '');
  type(el, '3', 1);
  assert.equal(el.value, '(3__) ___-____');
  value.set('');
  assert.equal(el.value, '', 'clearing the signal clears the field');
  teardown(el, owner);
});

test('action: a programmatic signal change re-renders the display', () => {
  const { el, owner, value } = mountInput();
  value.set('3706001234');
  assert.equal(el.value, '(370) 600-1234');
  teardown(el, owner);
});

test('action: an IME composition is left alone until it commits', () => {
  const el: HTMLInputElement = document.createElement('input');
  document.body.appendChild(el);
  const value: Signal<string> = signal<string>('');
  const owner: Owner = createOwner();
  runInOwner(owner, () => mask(el, { value, template: 'aaaa' }));

  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  el.value = 'こんに';
  el.setSelectionRange(3, 3);
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  assert.equal(value(), '', 'nothing is committed mid-composition');
  assert.equal(el.value, 'こんに', 'and the element is not rewritten under the IME');

  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(value(), 'こんに', 'the commit lands once composition ends');

  disposeOwner(owner);
  el.remove();
});

test('action: disposal removes the listeners', () => {
  const { el, owner, value } = mountInput();
  disposeOwner(owner);
  type(el, '370', 3);
  assert.equal(value(), '', 'a disposed mask no longer tracks the element');
  el.remove();
});
