import { test, assert } from '../../../tools/harness.js';
import { field, form, validators, type Field, type Group } from '@weave-framework/forms';

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
