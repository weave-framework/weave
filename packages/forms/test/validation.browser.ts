import { test, assert } from '../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from '@weave/runtime';
import { field, form, validators, type Field, type Group } from '@weave/forms';

const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/* ──────────────────────────── cross-field ──────────────────────────── */

test('cross-field: a field-keyed error attaches to that field and gates form validity', () => {
  const owner: Owner = createOwner();
  const f: Group<{ pw: Field<string>; pw2: Field<string> }> = runInOwner(owner, () =>
    form(
      { pw: field('secret'), pw2: field('', [validators.required()]) },
      { validate: (v) => (v.pw === v.pw2 ? null : { pw2: 'passwords do not match' }) }
    )
  );

  f.controls.pw2.value.set('typo');
  assert.equal(f.controls.pw2.error(), 'passwords do not match', 'cross-field error shows on the field');
  assert.equal(f.valid(), false, 'form invalid while the cross-field check fails');

  f.controls.pw2.value.set('secret');
  assert.equal(f.controls.pw2.error(), null, 'clears when the values match');
  assert.equal(f.valid(), true);
  disposeOwner(owner);
});

test('cross-field: own sync validators take precedence over the cross-field error', () => {
  const owner: Owner = createOwner();
  const f: Group<{ pw: Field<string>; pw2: Field<string> }> = runInOwner(owner, () =>
    form(
      { pw: field('secret'), pw2: field('', [validators.required('required!')]) },
      { validate: (v) => (v.pw === v.pw2 ? null : { pw2: 'mismatch' }) }
    )
  );
  // pw2 is empty → its own required() fails first, even though the cross-field also fails
  assert.equal(f.controls.pw2.error(), 'required!', 'sync validator wins');
  disposeOwner(owner);
});

test('cross-field: a reserved _form key surfaces as a form-level error', () => {
  const owner: Owner = createOwner();
  const f: Group<{ from: Field<number>; to: Field<number> }> = runInOwner(owner, () =>
    form(
      { from: field(10), to: field(5) },
      { validate: (v) => (v.to >= v.from ? null : { _form: 'range is inverted' }) }
    )
  );
  assert.equal(f.formError(), 'range is inverted', 'form-level error exposed');
  assert.equal(f.valid(), false, 'form-level error makes the form invalid');
  assert.equal(f.controls.to.error(), null, 'and it is NOT attached to any field');

  f.controls.to.value.set(20);
  assert.equal(f.formError(), null, 'clears when the cross-field condition holds');
  assert.equal(f.valid(), true);
  disposeOwner(owner);
});

/* ──────────────────────────── async ──────────────────────────── */

test('async: validating() toggles and the error lands after the debounce', async () => {
  const owner: Owner = createOwner();
  const taken: Set<string> = new Set(['taken']);
  const username: Field<string> = runInOwner(owner, () =>
    field('', [validators.required()], {
      asyncValidate: async (v) => (taken.has(v) ? 'already taken' : null),
      debounceMs: 20,
    })
  );

  username.value.set('taken');
  assert.equal(username.validating(), true, 'enters the validating state immediately');
  assert.equal(username.error(), null, 'optimistically clear while checking');

  await wait(60);
  assert.equal(username.validating(), false, 'done validating');
  assert.equal(username.error(), 'already taken', 'async error surfaced');

  username.value.set('free');
  await wait(60);
  assert.equal(username.error(), null, 'clears for an available value');
  disposeOwner(owner);
});

test('async: rapid edits debounce + abort to a single trailing call', async () => {
  const owner: Owner = createOwner();
  const calls: string[] = [];
  const f: Field<string> = runInOwner(owner, () =>
    field('', [validators.required()], {
      asyncValidate: async (v) => {
        calls.push(v);
        return null;
      },
      debounceMs: 20,
    })
  );

  f.value.set('a');
  f.value.set('ab');
  f.value.set('abc'); // all within the debounce window
  await wait(60);
  assert.deepEqual(calls, ['abc'], 'only the final value reached the server');
  disposeOwner(owner);
});

test('async: a sync (format) error skips the server check entirely', async () => {
  const owner: Owner = createOwner();
  let called: number = 0;
  const f: Field<string> = runInOwner(owner, () =>
    field('', [validators.email()], {
      asyncValidate: async () => {
        called++;
        return null;
      },
      debounceMs: 20,
    })
  );

  f.value.set('not-an-email');
  await wait(60);
  assert.equal(called, 0, 'no async call while the value is format-invalid');
  assert.equal(f.error(), 'Enter a valid email', 'the sync error shows');
  assert.equal(f.validating(), false);

  f.value.set('a@b.co');
  await wait(60);
  assert.equal(called, 1, 'async runs once the format is valid');
  disposeOwner(owner);
});

test('form.validating() is true while any field checks', async () => {
  const owner: Owner = createOwner();
  const f: Group<{ u: Field<string> }> = runInOwner(owner, () =>
    form({
      u: field('', [validators.required()], {
        asyncValidate: async () => null,
        debounceMs: 20,
      }),
    })
  );
  f.controls.u.value.set('x');
  assert.equal(f.validating(), true, 'form reflects a field in flight');
  await wait(60);
  assert.equal(f.validating(), false);
  disposeOwner(owner);
});
