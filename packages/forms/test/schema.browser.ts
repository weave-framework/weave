import { test, assert } from '../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import {
  schemaForm,
  fieldType,
  getFieldType,
  fieldTypeNames,
  type FieldTypeDef,
  type SchemaForm,
  type RenderField,
} from '@weave-framework/forms/schema';

/* ─────────────────────── building & values ─────────────────────── */

test('schemaForm builds one field per schema field, with typed defaults and a values snapshot', () => {
  const f: SchemaForm = schemaForm({
    fields: [
      { name: 'name', type: 'text' },
      { name: 'age', type: 'number' },
      { name: 'tos', type: 'checkbox' },
    ],
  });
  assert.deepEqual(f.value(), { name: '', age: null, tos: false }, 'type defaults seed the snapshot');
  f.controls.name.value.set('Ada');
  assert.equal(f.value().name, 'Ada', 'editing a field flows into the group snapshot');
});

test('explicit initial overrides the type default', () => {
  const f: SchemaForm = schemaForm({ fields: [{ name: 'name', type: 'text', initial: 'seed' }] });
  assert.equal(f.value().name, 'seed');
});

/* ─────────────────────── constraint validators ─────────────────────── */

test('required builds a validator: empty is invalid, filled is valid', () => {
  const f: SchemaForm = schemaForm({ fields: [{ name: 'name', type: 'text', required: true }] });
  assert.equal(f.controls.name.valid(), false, 'empty required field is invalid');
  assert.equal(f.controls.name.error(), 'Required');
  f.controls.name.value.set('x');
  assert.equal(f.controls.name.valid(), true, 'valid once filled');
});

test('number type coerces the initial and enforces min', () => {
  const f: SchemaForm = schemaForm({ fields: [{ name: 'age', type: 'number', min: 18, initial: '20' }] });
  assert.equal(f.value().age, 20, 'string initial coerced to a number');
  f.controls.age.value.set(5);
  assert.equal(f.controls.age.error(), 'Must be ≥ 18', 'min enforced');
  f.controls.age.value.set(18);
  assert.equal(f.controls.age.valid(), true);
});

test('optional constraints skip an empty value (emptiness is only required’s job)', () => {
  const f: SchemaForm = schemaForm({ fields: [{ name: 'email', type: 'email', minLength: 5 }] });
  assert.equal(f.controls.email.valid(), true, 'empty optional email is valid — email/minLength skipped');
  f.controls.email.value.set('not-an-email'); // passes minLength(5), fails the email check
  assert.equal(f.controls.email.error(), 'Enter a valid email', 'a non-empty bad email fails');
});

/* ─────────────────────── render model ─────────────────────── */

test('render() exposes the control component + merged props + label', () => {
  const f: SchemaForm = schemaForm({
    fields: [
      { name: 'email', type: 'email', label: 'Email' },
      { name: 'plan', type: 'select', options: [{ value: 'free', label: 'Free' }], props: { clearable: true } },
    ],
  });
  const r: RenderField[] = f.render();
  assert.equal(r.length, 2);
  assert.equal(r[0].control, 'input', 'email renders as input');
  assert.equal((r[0].props as { type?: string }).type, 'email', 'type prop from the field type');
  assert.equal(r[0].label, 'Email');
  assert.equal(r[1].control, 'select');
  assert.deepEqual((r[1].props as { options?: unknown }).options, [{ value: 'free', label: 'Free' }]);
  assert.equal((r[1].props as { clearable?: boolean }).clearable, true, 'field props override/merge over the type props');
  assert.equal(r[0].field, f.controls.email, 'the descriptor carries the live field');
});

/* ─────────────────────── registry ─────────────────────── */

test('unknown field type fails loud', () => {
  let threw: boolean = false;
  try {
    schemaForm({ fields: [{ name: 'x', type: 'no-such-type' }] });
  } catch (e) {
    threw = true;
    assert.ok(String((e as Error).message).includes('no-such-type'), 'error names the missing type');
  }
  assert.equal(threw, true, 'schemaForm throws on an unregistered type');
});

test('fieldType registers a custom type globally', () => {
  fieldType<string>({
    name: 'slug',
    control: 'input',
    defaultValue: '',
    props: () => ({ spellcheck: false }),
    validators: () => [(v) => (/^[a-z-]*$/.test(v) ? null : 'lowercase and dashes only')],
  });
  assert.ok(fieldTypeNames().includes('slug'));
  assert.equal(getFieldType('slug')?.control, 'input');
  const f: SchemaForm = schemaForm({ fields: [{ name: 's', type: 'slug' }] });
  f.controls.s.value.set('Bad Slug');
  assert.equal(f.controls.s.error(), 'lowercase and dashes only');
  assert.equal((f.render()[0].props as { spellcheck?: boolean }).spellcheck, false);
});

test('per-form types win over the global registry without mutating it', () => {
  const loud: FieldTypeDef<string> = {
    name: 'text',
    control: 'shouty-input',
    defaultValue: 'HELLO',
  };
  const f: SchemaForm = schemaForm({ fields: [{ name: 'a', type: 'text' }] }, { types: [loud] });
  assert.equal(f.render()[0].control, 'shouty-input', 'scoped type used');
  assert.equal(f.value().a, 'HELLO');
  // global 'text' is untouched
  const g: SchemaForm = schemaForm({ fields: [{ name: 'a', type: 'text' }] });
  assert.equal(g.render()[0].control, 'input', 'global registry not mutated');
});

/* ─────────────────────── composes group features ─────────────────────── */

test('cross-field validate + dirty/reset still work (delegates to group)', () => {
  const owner: Owner = createOwner();
  const f: SchemaForm = runInOwner(owner, () =>
    schemaForm({
      fields: [
        { name: 'pw', type: 'password' },
        { name: 'pw2', type: 'password' },
      ],
      validate: (v) => (v.pw === v.pw2 ? null : { pw2: 'passwords do not match' }),
    })
  );
  assert.equal(f.dirty(), false, 'pristine at birth');
  f.controls.pw.value.set('secret');
  assert.equal(f.dirty(), true, 'dirty after an edit');
  f.controls.pw2.value.set('typo');
  assert.equal(f.controls.pw2.error(), 'passwords do not match', 'cross-field error routes to the field');
  assert.equal(f.valid(), false);
  f.controls.pw2.value.set('secret');
  assert.equal(f.valid(), true);
  f.reset();
  assert.equal(f.dirty(), false, 'reset clears dirty');
  assert.equal(f.value().pw, '', 'reset restores initial');
  disposeOwner(owner);
});

test('checkbox required must be checked', () => {
  const f: SchemaForm = schemaForm({ fields: [{ name: 'tos', type: 'checkbox', required: true }] });
  assert.equal(f.controls.tos.valid(), false, 'unchecked required checkbox is invalid');
  f.controls.tos.value.set(true);
  assert.equal(f.controls.tos.valid(), true);
});
