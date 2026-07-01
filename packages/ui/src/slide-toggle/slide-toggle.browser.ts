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
  type SlideToggleProps,
  type SlideToggleContext,
  type SlideToggleControl,
} from '@weave-framework/ui/slide-toggle';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'input', 'rootClass', 'isChecked', 'isDisabled', 'isRequired', 'name', 'label', 'onNativeChange', 'onBlur',
];

function mount(props: SlideToggleProps): { root: HTMLElement; input: HTMLInputElement; track: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: SlideToggleContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(root);
  const input: HTMLInputElement = root.querySelector<HTMLInputElement>('.weave-slide-toggle__input')!;
  const track: HTMLElement = root.querySelector<HTMLElement>('.weave-slide-toggle__track')!;
  return { root, input, track, dispose: (): void => { disposeOwner(owner); root.remove(); } };
}

type TestControl = SlideToggleControl & { value: Signal<boolean>; touched: Signal<boolean> };
function makeControl(initial: boolean, error: string | null = null): TestControl {
  return { value: signal(initial), touched: signal(false), error: (): string | null => error };
}

/* ─────────────────────────── structure + a11y ─────────────────────────── */

test('renders a <label> wrapping a role=switch checkbox + track', () => {
  const { root, input, track, dispose } = mount({ label: 'Wi-Fi' });
  assert.equal(root.tagName, 'LABEL');
  assert.equal(input.type, 'checkbox', 'a real native checkbox');
  assert.equal(input.getAttribute('role'), 'switch', 'switch semantics');
  assert.ok(track, 'the __track visual is present');
  assert.equal(track.getAttribute('aria-hidden'), 'true');
  assert.equal(root.querySelector('.weave-slide-toggle__label')?.textContent, 'Wi-Fi');
  dispose();
});

test('no label prop renders no __label element', () => {
  const { root, dispose } = mount({});
  assert.equal(root.querySelector('.weave-slide-toggle__label'), null);
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
  assert.equal(input.checked, true);
  input.click();
  assert.equal(seen.at(-1), false, 'on → off');
  dispose();
});

test('an external value change reflows into the input', () => {
  const value: Signal<boolean> = signal(false);
  const { input, dispose } = mount({ get checked() { return value(); }, onChange: () => {} });
  assert.equal(input.checked, false);
  value.set(true);
  assert.equal(input.checked, true, 'source → DOM');
  dispose();
});

/* ─────────────────────────── forms control binding ─────────────────────────── */

test('control: clicking writes the field value two-way', () => {
  const control: TestControl = makeControl(false);
  const { input, dispose } = mount({ control });
  input.click();
  assert.equal(control.value(), true);
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
  assert.equal(input.checked, true, 'control drives, not `checked`');
  input.click();
  assert.equal(onChangeCalls, 0, 'onChange bypassed when a control is bound');
  assert.equal(control.value(), false, 'the field took the toggle');
  dispose();
});

test('control: blur marks the field touched', () => {
  const control: TestControl = makeControl(false);
  const { input, dispose } = mount({ control });
  assert.equal(control.touched(), false);
  input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  assert.equal(control.touched(), true);
  dispose();
});

test('control: aria-invalid only while touched AND invalid', () => {
  const control: TestControl = makeControl(false, 'Required');
  const { input, dispose } = mount({ control });
  assert.ok(!input.hasAttribute('aria-invalid'), 'untouched → none');
  control.touched.set(true);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  dispose();
});

/* ─────────────────────────── native attrs ─────────────────────────── */

test('disabled + required + name are reflected on the native input', () => {
  const { input, dispose } = mount({ disabled: true, required: true, name: 'wifi' });
  assert.equal(input.disabled, true);
  assert.equal(input.required, true);
  assert.equal(input.name, 'wifi');
  dispose();
});

test('forwarded class is appended to the label root', () => {
  const { root, dispose } = mount({ label: 'X', class: 'settings-toggle' });
  assert.ok(root.classList.contains('weave-slide-toggle') && root.classList.contains('settings-toggle'));
  dispose();
});
