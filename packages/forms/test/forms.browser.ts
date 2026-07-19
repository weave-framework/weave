import { test, assert } from '../../../tools/harness.js';
import { field, form, fieldArray, validators, type Field, type Group, type FieldArray } from '@weave-framework/forms';

test('field.dirty() tracks change from initial, cleared by reset / restoring the value', () => {
  const f: Field<string> = field('init');
  assert.equal(f.dirty(), false, 'pristine at start');
  f.value.set('changed');
  assert.equal(f.dirty(), true, 'dirty after an edit');
  f.value.set('init');
  assert.equal(f.dirty(), false, 'restoring the initial value → pristine again');
  f.value.set('x');
  f.reset();
  assert.equal(f.dirty(), false, 'reset clears dirty');
});

test('group.dirty() aggregates: true if any child changed', () => {
  const g: Group<{ a: Field<string>; b: Field<number> }> = form({ a: field('a'), b: field(0) });
  assert.equal(g.dirty(), false, 'pristine group');
  g.controls.b.value.set(5);
  assert.equal(g.dirty(), true, 'dirty once a child changes');
  g.reset();
  assert.equal(g.dirty(), false, 'reset cascades → pristine');
});

test('fieldArray.dirty(): item-set change (push/removeAt) or a dirty item; reset restores', () => {
  const arr: FieldArray<string> = fieldArray<string>((s) => field(s ?? ''), ['one', 'two']);
  assert.equal(arr.dirty(), false, 'pristine at seeds');
  arr.push('three');
  assert.equal(arr.dirty(), true, 'push makes it dirty');
  arr.reset();
  assert.equal(arr.dirty(), false, 'reset restores the seed set');
  (arr.controls()[0] as Field<string>).value.set('edited');
  assert.equal(arr.dirty(), true, 'a dirty item makes the array dirty');
});

test('fieldArray.dirty(): compensating edits that restore the LENGTH are still dirty', () => {
  // `dirty` compared the length against the seeds and asked each item whether it differed from ITS OWN
  // initial — never the array's value against the seed values. So any pair of edits that restored the count
  // read clean: remove one and add another, or reorder. `dirty` is the documented "unsaved changes" signal
  // and feeds router leave-guards, so the warning was simply not raised.
  const arr: FieldArray<string> = fieldArray<string>((s) => field(s ?? ''), ['a', 'b']);
  arr.removeAt(0);
  arr.push('c');
  assert.deepEqual(arr.value(), ['b', 'c'], 'the value really did change');
  assert.equal(arr.dirty(), true, 'remove + push is dirty even though the length matches');

  const reorder: FieldArray<string> = fieldArray<string>((s) => field(s ?? ''), ['x', 'y']);
  reorder.removeAt(0);
  reorder.push('x');
  assert.deepEqual(reorder.value(), ['y', 'x'], 'same members, different order');
  assert.equal(reorder.dirty(), true, 'a pure reorder is dirty');

  const blanked: FieldArray<string> = fieldArray<string>((s) => field(s ?? ''), ['seeded']);
  blanked.removeAt(0);
  blanked.push();
  assert.equal(blanked.dirty(), true, 'replacing an item with a blank one is dirty');

  arr.reset();
  assert.equal(arr.dirty(), false, 'reset still returns to pristine');
});

test('a field holding a FUNCTION stores it rather than calling it', () => {
  // `Signal.set` treats any function argument as an updater `(prev) => next`, so `value.set(initial)` in
  // `reset()` INVOKED a function-valued initial with the current value and stored the result. A field can
  // legitimately hold a formatter, a factory or a component.
  const fn = (): string => 'original';
  const other = (): string => 'other';
  const f: Field<() => string> = field<() => string>(fn);
  f.value.set(() => other);
  assert.is(f.value(), other, 'writing a function value stores it');
  f.reset();
  assert.is(f.value(), fn, 'reset restores the function itself, not the result of calling it');
});

test('field validates reactively (first failure wins)', () => {
  const email: Field<string> = field('', [validators.required(), validators.email()]);
  assert.equal(email.valid(), false);
  assert.equal(email.error(), 'Required', 'required fails first');

  email.value.set('x');
  assert.equal(email.error(), 'Enter a valid email', 'then email format');

  email.value.set('a@b.co');
  assert.equal(email.valid(), true);
  assert.equal(email.error(), null);
});

test('field reset restores the initial value and clears touched', () => {
  const f: Field<string> = field('init', [validators.minLength(2)]);
  f.value.set('changed');
  f.touched.set(true);
  f.reset();
  assert.equal(f.value(), 'init');
  assert.equal(f.touched(), false);
});

test('form aggregates validity + a values snapshot', () => {
  const f: Group<{ name: Field<string>; age: Field<number> }> = form({
    name: field('', [validators.required()]),
    age: field(0, [validators.min(18)]),
  });
  assert.equal(f.valid(), false, 'invalid while any field is invalid');

  f.controls.name.value.set('Aidas');
  f.controls.age.value.set(20);
  assert.equal(f.valid(), true);
  assert.deepEqual(f.value(), { name: 'Aidas', age: 20 });

  f.reset();
  assert.equal(f.controls.name.value(), '');
  assert.equal(f.controls.age.value(), 0);
});

test('touchAll marks every field touched', () => {
  const f: Group<{ a: Field<string>; b: Field<string> }> = form({ a: field(''), b: field('') });
  assert.equal(f.controls.a.touched(), false);
  f.touchAll();
  assert.equal(f.controls.a.touched(), true);
  assert.equal(f.controls.b.touched(), true);
});
