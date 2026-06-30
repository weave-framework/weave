import { test, assert } from '../../../tools/harness.js';
import { createOwner, runInOwner, type Owner } from '@weave-framework/runtime';
import { field, form, validators, type Field, type Group } from '@weave-framework/forms';
import { control } from '@weave-framework/forms/dom';

const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/* ──────────────────────────── form.submit ──────────────────────────── */

test('submit: runs the handler with the value snapshot when valid', async () => {
  const f: Group<{ name: Field<string> }> = form({ name: field('Aidas', [validators.required()]) });
  let got: { name: string } | null = null;
  await f.submit((v) => {
    got = v;
  })();
  assert.deepEqual(got, { name: 'Aidas' });
  assert.equal(f.submitting(), false, 'not submitting after it resolves');
  assert.equal(f.submitError(), undefined);
});

test('submit: blocks the handler when invalid and reveals every error', async () => {
  const f: Group<{ name: Field<string> }> = form({ name: field('', [validators.required()]) });
  let called: boolean = false;
  await f.submit(() => {
    called = true;
  })();
  assert.equal(called, false, 'handler is not called for an invalid form');
  assert.equal(f.controls.name.touched(), true, 'touchAll revealed the field error');
});

test('submit: captures a thrown error in submitError and clears submitting', async () => {
  const f: Group<{ name: Field<string> }> = form({ name: field('x') });
  await f.submit(() => {
    throw new Error('save failed');
  })();
  assert.equal((f.submitError() as Error).message, 'save failed');
  assert.equal(f.submitting(), false);
});

test('submit: preventDefault is called on the event', async () => {
  const f: Group<{ name: Field<string> }> = form({ name: field('x') });
  let prevented: boolean = false;
  await f.submit(() => undefined)({ preventDefault: () => (prevented = true) } as unknown as Event);
  assert.equal(prevented, true);
});

test('validateAsync: waits for an in-flight async validator before reporting validity', async () => {
  const owner: Owner = createOwner();
  const taken: Set<string> = new Set(['dupe']);
  const f: Group<{ u: Field<string> }> = runInOwner(owner, () =>
    form({
      u: field('dupe', [], {
        asyncValidate: async (v) => {
          await wait(20);
          return taken.has(v) ? 'taken' : null;
        },
      }),
    })
  );
  // Right after creation the async check is still pending → validateAsync must wait, not race.
  const ok: boolean = await f.validateAsync();
  assert.equal(ok, false, 'resolves false once the async "taken" error has landed');
  assert.equal(f.controls.u.error(), 'taken');
});

/* ──────────────────────────── use:control directive ──────────────────────────── */

test('control: two-way binds value, sets touched on blur, toggles aria-invalid', () => {
  const owner: Owner = createOwner();
  const f: Field<string> = field('', [validators.required('req')]);
  const input: HTMLInputElement = document.createElement('input');
  document.body.appendChild(input);
  runInOwner(owner, () => control(input, f as Field<unknown>));

  assert.equal(input.value, '', 'seeded from the field');
  assert.equal(input.getAttribute('aria-invalid'), null, 'not flagged before touched');

  // blur marks touched → invalid (empty + required) → aria-invalid set
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  assert.equal(f.touched(), true);
  assert.equal(input.getAttribute('aria-invalid'), 'true', 'flagged once touched + invalid');

  // a real edit flows back into the field and clears the flag
  input.value = 'hello';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(f.value(), 'hello', 'input → field');
  assert.equal(input.getAttribute('aria-invalid'), null, 'flag cleared once valid');

  input.remove();
});

test('control: a checkbox binds via `checked`', () => {
  const owner: Owner = createOwner();
  const f: Field<boolean> = field(true);
  const box: HTMLInputElement = document.createElement('input');
  box.type = 'checkbox';
  document.body.appendChild(box);
  runInOwner(owner, () => control(box, f as unknown as Field<unknown>));

  assert.equal(box.checked, true, 'seeded from the boolean field');
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(f.value(), false, 'checkbox → field');
  box.remove();
});
