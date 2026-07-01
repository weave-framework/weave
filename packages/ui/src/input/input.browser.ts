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
import { setup, template, type InputProps, type InputContext, type InputControl } from '@weave-framework/ui/input';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount prefix/suffix collapse). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'root', 'input', 'rootClass', 'multiline', 'singleline', 'type', 'rows', 'placeholder', 'currentValue',
  'isDisabled', 'isReadonly', 'isRequired', 'name', 'label', 'showClear', 'clearLabel', 'onNativeInput', 'onBlur', 'clear',
];

type Slots = { prefix?: () => Node; suffix?: () => Node };
type RenderFn = (ctx: InputContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: InputContext, rt: unknown, c: unknown) => RenderFn;
type Mounted = {
  root: HTMLElement;
  field: HTMLInputElement & HTMLTextAreaElement;
  clear: HTMLButtonElement | null;
  dispose: () => void;
};

function mount(props: InputProps, slots: Slots = {}): Mounted {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: InputContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;')
    ) as MakeRender;
    const render: RenderFn = make(ctx, rt, {});
    return render(ctx, slots as Record<string, () => Node>);
  });
  document.body.appendChild(root);
  const field: HTMLInputElement & HTMLTextAreaElement = root.querySelector<HTMLInputElement & HTMLTextAreaElement>('.weave-input__field')!;
  return {
    root,
    field,
    clear: root.querySelector<HTMLButtonElement>('.weave-input__clear'),
    dispose: (): void => { disposeOwner(owner); root.remove(); },
  };
}

type TestControl = InputControl & { value: Signal<string>; touched: Signal<boolean> };
function makeControl(initial: string, error: string | null = null): TestControl {
  return { value: signal(initial), touched: signal(false), error: (): string | null => error };
}
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string): void => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

/* ─────────────────────────── structure ─────────────────────────── */

test('renders an underline field wrapping a native text input', () => {
  const { root, field, dispose } = mount({ placeholder: 'Email' });
  assert.ok(root.classList.contains('weave-input'));
  assert.equal(field.tagName, 'INPUT');
  assert.equal(field.type, 'text', 'defaults to type=text');
  assert.equal(field.placeholder, 'Email');
  dispose();
});

test('type is forwarded', () => {
  const { field, dispose } = mount({ type: 'email' });
  assert.equal(field.type, 'email');
  dispose();
});

/* ─────────────────────────── signal two-way ─────────────────────────── */

test('value prop drives the field', () => {
  const { field, dispose } = mount({ value: 'hello' });
  assert.equal(field.value, 'hello');
  dispose();
});

test('typing emits onInput and reflects two-way', () => {
  const value: Signal<string> = signal('');
  const seen: string[] = [];
  const { field, dispose } = mount({ get value() { return value(); }, onInput: (v) => { seen.push(v); value.set(v); } });
  type(field, 'abc');
  assert.equal(seen.at(-1), 'abc');
  assert.equal(field.value, 'abc');
  dispose();
});

test('an external value change reflows into the field', () => {
  const value: Signal<string> = signal('a');
  const { field, dispose } = mount({ get value() { return value(); }, onInput: () => {} });
  assert.equal(field.value, 'a');
  value.set('z');
  assert.equal(field.value, 'z');
  dispose();
});

/* ─────────────────────────── forms control ─────────────────────────── */

test('control: typing writes the field value two-way', () => {
  const control: TestControl = makeControl('');
  const { field, dispose } = mount({ control });
  type(field, 'weave');
  assert.equal(control.value(), 'weave');
  dispose();
});

test('control wins over value/onInput', () => {
  const control: TestControl = makeControl('field-driven');
  let onInputCalls: number = 0;
  const { field, dispose } = mount({ control, value: 'ignored', onInput: () => (onInputCalls += 1) });
  assert.equal(field.value, 'field-driven');
  type(field, 'x');
  assert.equal(onInputCalls, 0, 'onInput bypassed when a control is bound');
  assert.equal(control.value(), 'x');
  dispose();
});

test('control: blur marks touched; --invalid + aria-invalid when touched AND invalid', () => {
  const control: TestControl = makeControl('', 'Required');
  const { root, field, dispose } = mount({ control });
  assert.ok(!root.classList.contains('weave-input--invalid'), 'untouched → valid');
  assert.ok(!field.hasAttribute('aria-invalid'));
  field.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  assert.equal(control.touched(), true);
  assert.ok(root.classList.contains('weave-input--invalid'), 'touched + error → --invalid');
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  dispose();
});

/* ─────────────────────────── native attrs ─────────────────────────── */

test('disabled / readonly / required / name are reflected', () => {
  const { field, dispose } = mount({ disabled: true, readonly: true, required: true, name: 'email' });
  assert.equal(field.disabled, true);
  assert.equal(field.readOnly, true);
  assert.equal(field.required, true);
  assert.equal(field.name, 'email');
  dispose();
});

/* ─────────────────────────── multiline ─────────────────────────── */

test('multiline renders a <textarea> with rows', () => {
  const { root, field, dispose } = mount({ multiline: true, rows: 5, value: 'note' });
  assert.equal(field.tagName, 'TEXTAREA');
  assert.equal(field.rows, 5);
  assert.equal(field.value, 'note');
  assert.ok(root.classList.contains('weave-input--multiline'));
  assert.equal(root.querySelector('input'), null, 'no <input> in multiline mode');
  dispose();
});

/* ─────────────────────────── clearable ─────────────────────────── */

test('clearable: the × shows only when non-empty and editable', () => {
  const empty: Mounted = mount({ clearable: true, value: '' });
  assert.equal(empty.clear, null, 'hidden when empty');
  empty.dispose();

  const filled: Mounted = mount({ clearable: true, value: 'x' });
  assert.ok(filled.clear, 'shown when non-empty');
  filled.dispose();

  const ro: Mounted = mount({ clearable: true, value: 'x', readonly: true });
  assert.equal(ro.clear, null, 'hidden when read-only');
  ro.dispose();
});

test('clicking clear empties the value (and the button disappears)', () => {
  const value: Signal<string> = signal('hello');
  const { root, clear, dispose } = mount({ clearable: true, get value() { return value(); }, onInput: (v) => value.set(v) });
  clear!.click();
  assert.equal(value(), '', 'value cleared');
  assert.equal(root.querySelector('.weave-input__clear'), null, 'the × is gone once empty');
  dispose();
});

/* ─────────────────────────── prefix / suffix ─────────────────────────── */

test('prefix / suffix slots render; empty ones collapse (--empty)', async () => {
  const { root, dispose } = mount({ value: '' }, { prefix: (): Node => document.createTextNode('$') });
  const prefix: HTMLElement = root.querySelector('.weave-input__prefix')!;
  const suffix: HTMLElement = root.querySelector('.weave-input__suffix')!;
  assert.equal(prefix.textContent, '$', 'prefix content projected');
  await tick(); // onMount collapses the empties
  assert.ok(!prefix.classList.contains('weave-input__prefix--empty'), 'filled prefix stays');
  assert.ok(suffix.classList.contains('weave-input__suffix--empty'), 'empty suffix collapses');
  dispose();
});

test('with no adornments both prefix and suffix collapse', async () => {
  const { root, dispose } = mount({ value: 'x' });
  await tick();
  assert.ok(root.querySelector('.weave-input__prefix')!.classList.contains('weave-input__prefix--empty'));
  assert.ok(root.querySelector('.weave-input__suffix')!.classList.contains('weave-input__suffix--empty'));
  dispose();
});

/* ─────────────────────────── forwarding ─────────────────────────── */

test('forwarded class is appended to the field wrapper', () => {
  const { root, dispose } = mount({ class: 'search-field' });
  assert.ok(root.classList.contains('weave-input') && root.classList.contains('search-field'));
  dispose();
});
