import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  type Signal,
  type Owner,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import {
  setup,
  template,
  type CheckboxProps,
  type CheckboxContext,
  type CheckboxControl,
} from '@weave-framework/ui/checkbox';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'input', 'rootClass', 'isDisabled', 'isRequired', 'name', 'label', 'onNativeChange', 'onBlur',
];

function mount(props: CheckboxProps): { root: HTMLElement; input: HTMLInputElement; box: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: CheckboxContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(root);
  const input: HTMLInputElement = root.querySelector<HTMLInputElement>('.weave-checkbox__input')!;
  const box: HTMLElement = root.querySelector<HTMLElement>('.weave-checkbox__box')!;
  return { root, input, box, dispose: (): void => { disposeOwner(owner); root.remove(); } };
}

/** A minimal forms Field<boolean> stand-in (a real Field satisfies CheckboxControl). */
type TestControl = CheckboxControl & { value: Signal<boolean>; touched: Signal<boolean> };
function makeControl(initial: boolean, error: string | null = null): TestControl {
  return { value: signal(initial), touched: signal(false), error: (): string | null => error };
}

/* ─────────────────────────── structure ─────────────────────────── */

test('renders a <label> wrapping a native checkbox + box (+ label text)', () => {
  const { root, input, box, dispose } = mount({ label: 'Done' });
  assert.equal(root.tagName, 'LABEL');
  assert.equal(input.type, 'checkbox', 'a real native checkbox');
  assert.ok(box, 'the __box visual is present');
  assert.equal(root.querySelector('.weave-checkbox__label')?.textContent, 'Done');
  assert.equal(box.getAttribute('aria-hidden'), 'true', 'the visual box is hidden from AT');
  dispose();
});

test('no label prop renders no __label element', () => {
  const { root, dispose } = mount({});
  assert.equal(root.querySelector('.weave-checkbox__label'), null);
  dispose();
});

/* ─────────────────────────── signal two-way ─────────────────────────── */

test('checked prop drives the native input', () => {
  const { input, dispose } = mount({ checked: true });
  assert.equal(input.checked, true);
  dispose();
});

test('clicking toggles and emits onChange with the next state', () => {
  const value: Signal<boolean> = signal(false);
  const seen: boolean[] = [];
  const { input, dispose } = mount({
    get checked() { return value(); },
    onChange: (v) => { seen.push(v); value.set(v); },
  });
  input.click();
  assert.equal(seen.at(-1), true, 'off → on');
  assert.equal(input.checked, true, 'input reflects the new value');
  input.click();
  assert.equal(seen.at(-1), false, 'on → off');
  assert.equal(value(), false);
  dispose();
});

test('an external value change reflows into the input', () => {
  const value: Signal<boolean> = signal(false);
  const { input, dispose } = mount({ get checked() { return value(); }, onChange: () => {} });
  assert.equal(input.checked, false);
  value.set(true);
  assert.equal(input.checked, true, 'source → DOM sync');
  dispose();
});

/* ─────────────────────────── forms control binding ─────────────────────────── */

test('control: clicking writes the field value two-way', () => {
  const control: TestControl = makeControl(false);
  const { input, dispose } = mount({ control });
  input.click();
  assert.equal(control.value(), true, 'field value updated');
  assert.equal(input.checked, true);
  dispose();
});

test('control: a field value change reflows into the input', () => {
  const control: TestControl = makeControl(false);
  const { input, dispose } = mount({ control });
  control.value.set(true);
  assert.equal(input.checked, true);
  dispose();
});

test('control wins over checked/onChange', () => {
  const control: TestControl = makeControl(true);
  let onChangeCalls: number = 0;
  const { input, dispose } = mount({ control, checked: false, onChange: () => (onChangeCalls += 1) });
  assert.equal(input.checked, true, 'control drives the value, not `checked`');
  input.click();
  assert.equal(onChangeCalls, 0, 'onChange is bypassed when a control is bound');
  assert.equal(control.value(), false, 'the field took the toggle');
  dispose();
});

test('control: blur marks the field touched', () => {
  const control: TestControl = makeControl(false);
  const { input, dispose } = mount({ control });
  assert.equal(control.touched(), false);
  input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  assert.equal(control.touched(), true, 'touched set on blur');
  dispose();
});

test('control: aria-invalid appears only while touched AND invalid', () => {
  const control: TestControl = makeControl(false, 'Required');
  const { input, dispose } = mount({ control });
  assert.ok(!input.hasAttribute('aria-invalid'), 'untouched → no aria-invalid');
  control.touched.set(true);
  assert.equal(input.getAttribute('aria-invalid'), 'true', 'touched + error → aria-invalid');
  dispose();
});

test('control: a valid touched field has no aria-invalid', () => {
  const control: TestControl = makeControl(true, null);
  const { input, dispose } = mount({ control });
  control.touched.set(true);
  assert.ok(!input.hasAttribute('aria-invalid'), 'no error → no aria-invalid even when touched');
  dispose();
});

/* ─────────────────────────── tri-state + native attrs ─────────────────────────── */

test('indeterminate sets the DOM input .indeterminate (native "mixed")', () => {
  const { input, dispose } = mount({ indeterminate: true });
  assert.equal(input.indeterminate, true);
  dispose();
});

test('disabled + required + name are reflected on the native input', () => {
  const { input, dispose } = mount({ disabled: true, required: true, name: 'agree' });
  assert.equal(input.disabled, true);
  assert.equal(input.required, true);
  assert.equal(input.name, 'agree');
  dispose();
});

test('forwarded class is appended to the label root', () => {
  const { root, dispose } = mount({ label: 'X', class: 'row-check' });
  assert.ok(root.classList.contains('weave-checkbox') && root.classList.contains('row-check'));
  dispose();
});
