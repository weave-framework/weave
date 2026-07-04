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
