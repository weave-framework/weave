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
  type RadioGroupProps,
  type RadioGroupContext,
  type RadioOption,
  type RadioControl,
} from '@weave-framework/ui/radio';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'groupClass', 'root', 'label', 'name', 'options', 'isSelected', 'isOptionDisabled', 'onNativeChange', 'onFocusOut',
];

function mount(props: RadioGroupProps): { group: HTMLElement; inputs: HTMLInputElement[]; dispose: () => void } {
  const owner: Owner = createOwner();
  const group: HTMLElement = runInOwner(owner, () => {
    const ctx: RadioGroupContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(group);
  const inputs: HTMLInputElement[] = Array.from(group.querySelectorAll<HTMLInputElement>('.weave-radio__input'));
  return { group, inputs, dispose: (): void => { disposeOwner(owner); group.remove(); } };
}

const OPTS: RadioOption[] = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
];

type TestControl = RadioControl & { value: Signal<string>; touched: Signal<boolean> };
function makeControl(initial: string, error: string | null = null): TestControl {
  return { value: signal(initial), touched: signal(false), error: (): string | null => error };
}

/* ─────────────────────────── structure ─────────────────────────── */

test('renders a radiogroup of native radios sharing a name', () => {
  const { group, inputs, dispose } = mount({ options: OPTS, value: 'free' });
  assert.equal(group.getAttribute('role'), 'radiogroup');
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every((i) => i.type === 'radio'), 'each is a native radio');
  const names: Set<string> = new Set(inputs.map((i) => i.name));
  assert.equal(names.size, 1, 'all share one name');
  assert.ok([...names][0].length > 0, 'the shared name is non-empty');
  assert.deepEqual(inputs.map((i) => i.value), ['free', 'pro', 'team']);
  assert.equal(group.querySelector('.weave-radio__label')?.textContent, 'Free');
  dispose();
});

test('a provided name is used verbatim', () => {
  const { inputs, dispose } = mount({ options: OPTS, value: 'free', name: 'plan' });
  assert.ok(inputs.every((i) => i.name === 'plan'));
  dispose();
});

test('label falls back to value when omitted', () => {
  const { group, dispose } = mount({ options: [{ value: 'x' }], value: null });
  assert.equal(group.querySelector('.weave-radio__label')?.textContent, 'x');
  dispose();
});

/* ─────────────────────────── signal two-way ─────────────────────────── */

test('value checks the matching radio', () => {
  const { inputs, dispose } = mount({ options: OPTS, value: 'pro' });
  assert.deepEqual(inputs.map((i) => i.checked), [false, true, false]);
  dispose();
});

test('clicking a radio emits its value and reflects two-way', () => {
  const value: Signal<string> = signal('free');
  const seen: string[] = [];
  const { inputs, dispose } = mount({
    options: OPTS,
    get value() { return value(); },
    onChange: (v) => { seen.push(v); value.set(v); },
  });
  inputs[2].click();
  assert.equal(seen.at(-1), 'team');
  assert.deepEqual(inputs.map((i) => i.checked), [false, false, true], 'only team checked');
  dispose();
});

test('an external value change moves the selection', () => {
  const value: Signal<string> = signal('free');
  const { inputs, dispose } = mount({ options: OPTS, get value() { return value(); }, onChange: () => {} });
  assert.deepEqual(inputs.map((i) => i.checked), [true, false, false]);
  value.set('team');
  assert.deepEqual(inputs.map((i) => i.checked), [false, false, true], 'source → DOM');
  dispose();
});

/* ─────────────────────────── forms control binding ─────────────────────────── */

test('control: clicking writes the field value two-way', () => {
  const control: TestControl = makeControl('free');
  const { inputs, dispose } = mount({ options: OPTS, control });
  inputs[1].click();
  assert.equal(control.value(), 'pro');
  assert.deepEqual(inputs.map((i) => i.checked), [false, true, false]);
  dispose();
});

test('control: a field value change moves the selection', () => {
  const control: TestControl = makeControl('free');
  const { inputs, dispose } = mount({ options: OPTS, control });
  control.value.set('team');
  assert.deepEqual(inputs.map((i) => i.checked), [false, false, true]);
  dispose();
});

test('control wins over value/onChange', () => {
  const control: TestControl = makeControl('pro');
  let onChangeCalls: number = 0;
  const { inputs, dispose } = mount({ options: OPTS, control, value: 'free', onChange: () => (onChangeCalls += 1) });
  assert.deepEqual(inputs.map((i) => i.checked), [false, true, false], 'control drives, not `value`');
  inputs[0].click();
  assert.equal(onChangeCalls, 0, 'onChange bypassed when a control is bound');
  assert.equal(control.value(), 'free', 'the field took the toggle');
  dispose();
});

test('control: focusout marks the field touched', () => {
  const control: TestControl = makeControl('free');
  const { inputs, dispose } = mount({ options: OPTS, control });
  assert.equal(control.touched(), false);
  inputs[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  assert.equal(control.touched(), true);
  dispose();
});

test('control: aria-invalid on the group only while touched AND invalid', () => {
  const control: TestControl = makeControl('', 'Pick a plan');
  const { group, dispose } = mount({ options: OPTS, control });
  assert.ok(!group.hasAttribute('aria-invalid'), 'untouched → none');
  control.touched.set(true);
  assert.equal(group.getAttribute('aria-invalid'), 'true');
  dispose();
});

/* ─────────────────────────── disabled + a11y ─────────────────────────── */

test('group disabled: every radio is disabled', () => {
  const { inputs, dispose } = mount({ options: OPTS, value: 'free', disabled: true });
  assert.ok(inputs.every((i) => i.disabled));
  dispose();
});

test('a per-option disabled flag disables just that radio', () => {
  const opts: RadioOption[] = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }];
  const { inputs, dispose } = mount({ options: opts, value: 'a' });
  assert.deepEqual(inputs.map((i) => i.disabled), [false, true]);
  dispose();
});

test('label sets the group aria-label', () => {
  const { group, dispose } = mount({ options: OPTS, value: 'free', label: 'Plan' });
  assert.equal(group.getAttribute('aria-label'), 'Plan');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { group, dispose } = mount({ options: OPTS, value: 'free', class: 'inline-radios' });
  assert.ok(group.classList.contains('weave-radio-group') && group.classList.contains('inline-radios'));
  dispose();
});
