import { test, assert } from '../../../tools/harness.js';
import { createOwner, runInOwner, type Owner } from '@weave/runtime';
import {
  field,
  form,
  group,
  fieldArray,
  validators,
  type Field,
  type Group,
  type FieldArray,
} from '@weave/forms';

/* ──────────────────────────── nested groups ──────────────────────────── */

test('group nests: value() snapshots recursively', () => {
  const f: Group<{ title: Field<string>; address: Group<{ street: Field<string>; city: Field<string> }> }> = form({
    title: field('Ship it'),
    address: group({ street: field('1 Main'), city: field('Town') }),
  });
  assert.deepEqual(f.value(), { title: 'Ship it', address: { street: '1 Main', city: 'Town' } });
  assert.equal(f.value().address.city, 'Town', 'a nested group contributes its own snapshot');
});

test('group validity recurses through a nested group', () => {
  const f: Group<{ address: Group<{ street: Field<string>; city: Field<string> }> }> = form({
    address: group({ street: field('', [validators.required()]), city: field('Town') }),
  });
  assert.equal(f.valid(), false, 'invalid while a deep child is invalid');
  f.controls.address.controls.street.value.set('1 Main');
  assert.equal(f.valid(), true, 'valid once the deep child is fixed');
});

test('touched() is derived (any descendant) and touchAll cascades', () => {
  const f: Group<{ a: Field<string>; nested: Group<{ b: Field<string> }> }> = form({
    a: field(''),
    nested: group({ b: field('') }),
  });
  assert.equal(f.touched(), false);
  f.touchAll();
  assert.equal(f.touched(), true, 'group touched once any descendant is');
  assert.equal(f.controls.nested.controls.b.touched(), true, 'touchAll reaches a deep field');
});

test('reset cascades to every descendant', () => {
  const f: Group<{ nested: Group<{ b: Field<string> }> }> = form({ nested: group({ b: field('seed') }) });
  f.controls.nested.controls.b.value.set('edited');
  f.controls.nested.controls.b.touched.set(true);
  f.reset();
  assert.equal(f.controls.nested.controls.b.value(), 'seed', 'value restored');
  assert.equal(f.controls.nested.controls.b.touched(), false, 'touched cleared');
});

test('cross-field validate at a nested-group level targets that group’s fields', () => {
  const f: Group<{ pair: Group<{ pw: Field<string>; pw2: Field<string> }> }> = form({
    pair: group(
      { pw: field('secret'), pw2: field('secret') },
      { validate: (v) => (v.pw === v.pw2 ? null : { pw2: 'mismatch' }) }
    ),
  });
  assert.equal(f.valid(), true, 'matching → valid');
  f.controls.pair.controls.pw2.value.set('typo');
  assert.equal(f.controls.pair.controls.pw2.error(), 'mismatch', 'group-level error lands on the field');
  assert.equal(f.valid(), false, 'a deep cross-field error gates the whole form');
});

/* ──────────────────────────── field arrays ──────────────────────────── */

test('fieldArray: seeds, push, removeAt, value()', () => {
  const tags: FieldArray<string> = fieldArray((s) => field(s ?? ''), ['a', 'b']);
  assert.equal(tags.length(), 2);
  assert.deepEqual(tags.value(), ['a', 'b']);

  tags.push('c');
  assert.deepEqual(tags.value(), ['a', 'b', 'c']);

  tags.removeAt(1);
  assert.deepEqual(tags.value(), ['a', 'c'], 'removeAt drops the right item');

  (tags.controls()[0] as Field<string>).value.set('A');
  assert.deepEqual(tags.value(), ['A', 'c'], 'editing an item reflects in value()');
});

test('fieldArray validity + touched aggregate over items; reset restores seeds', () => {
  const tags: FieldArray<string> = fieldArray((s) => field(s ?? '', [validators.required()]), ['x']);
  assert.equal(tags.valid(), true);
  tags.push(''); // a blank required item
  assert.equal(tags.valid(), false, 'invalid while any item is');

  tags.touchAll();
  assert.equal(tags.touched(), true);

  tags.reset();
  assert.equal(tags.length(), 1, 'reset restores the seeded items');
  assert.deepEqual(tags.value(), ['x']);
});

test('the full stack composes: form → fieldArray → group → field', () => {
  const owner: Owner = createOwner();
  const f: Group<{
    title: Field<string>;
    checklist: FieldArray<{ text: string; done: boolean }>;
  }> = runInOwner(owner, () =>
    form({
      title: field('Task', [validators.required()]),
      checklist: fieldArray(() => group({ text: field('', [validators.required()]), done: field(false) })),
    })
  );

  assert.equal(f.valid(), true, 'an empty checklist does not block validity');
  const arr: FieldArray<{ text: string; done: boolean }> = f.controls.checklist as FieldArray<{
    text: string;
    done: boolean;
  }>;
  arr.push();
  assert.equal(f.valid(), false, 'a blank required checklist item gates the form');

  const item: Group<{ text: Field<string>; done: Field<boolean> }> = arr.controls()[0] as Group<{
    text: Field<string>;
    done: Field<boolean>;
  }>;
  item.controls.text.value.set('Write tests');
  item.controls.done.value.set(true);
  assert.equal(f.valid(), true, 'valid once the deep field is filled');
  assert.deepEqual(f.value(), { title: 'Task', checklist: [{ text: 'Write tests', done: true }] });
});
