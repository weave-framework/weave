import { test, assert } from '../../../tools/harness.js';
import { field, form, validators, type Field, type Form } from '@weave/forms';

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
  const f: Form<{ name: Field<string>; age: Field<number> }> = form({
    name: field('', [validators.required()]),
    age: field(0, [validators.min(18)]),
  });
  assert.equal(f.valid(), false, 'invalid while any field is invalid');

  f.fields.name.value.set('Aidas');
  f.fields.age.value.set(20);
  assert.equal(f.valid(), true);
  assert.deepEqual(f.values(), { name: 'Aidas', age: 20 });

  f.reset();
  assert.equal(f.fields.name.value(), '');
  assert.equal(f.fields.age.value(), 0);
});

test('touchAll marks every field touched', () => {
  const f: Form<{ a: Field<string>; b: Field<string> }> = form({ a: field(''), b: field('') });
  assert.equal(f.fields.a.touched(), false);
  f.touchAll();
  assert.equal(f.fields.a.touched(), true);
  assert.equal(f.fields.b.touched(), true);
});
