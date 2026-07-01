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
  type FormFieldProps,
  type FormFieldContext,
  type FormFieldControl,
} from '@weave-framework/ui/form-field';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount auto-wiring). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = ['labelRef', 'controlWrap', 'rootClass', 'label', 'message', 'messageClass', 'messageId'];

type RenderFn = (ctx: FormFieldContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: FormFieldContext, rt: unknown, c: unknown) => RenderFn;

function mount(props: FormFieldProps, control?: Node): {
  root: HTMLElement;
  label: HTMLElement | null;
  input: HTMLInputElement | null;
  message: HTMLElement | null;
  dispose: () => void;
} {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: FormFieldContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;')
    ) as MakeRender;
    const render: RenderFn = make(ctx, rt, {});
    return render(ctx, control ? { default: (): Node => control } : {});
  });
  document.body.appendChild(root);
  return {
    root,
    label: root.querySelector<HTMLElement>('.weave-form-field__label'),
    input: root.querySelector<HTMLInputElement>('input'),
    message: root.querySelector<HTMLElement>('.weave-form-field__hint, .weave-form-field__error'),
    dispose: (): void => { disposeOwner(owner); root.remove(); },
  };
}

const anInput = (): HTMLInputElement => document.createElement('input');

/* ─────────────────────────── structure ─────────────────────────── */

test('renders a label, the slotted control, and a hint', () => {
  const { label, input, message, dispose } = mount({ label: 'Email', hint: 'We never share it' }, anInput());
  assert.equal(label?.textContent, 'Email');
  assert.ok(input, 'the slotted control is projected');
  assert.equal(message?.textContent, 'We never share it');
  assert.ok(message?.classList.contains('weave-form-field__hint'), 'the hint uses the hint class');
  dispose();
});

test('no label / no message renders neither element', () => {
  const { label, message, dispose } = mount({}, anInput());
  assert.equal(label, null);
  assert.equal(message, null);
  dispose();
});

/* ─────────────────────────── auto-wiring (deferred) ─────────────────────────── */

test('auto-wires the control id and the label for', async () => {
  const { label, input, dispose } = mount({ label: 'Name' }, anInput());
  await tick();
  assert.ok(input!.id.length > 0, 'the control gets a generated id');
  assert.equal(label!.getAttribute('for'), input!.id, 'label for → control id');
  dispose();
});

test('links the hint via aria-describedby', async () => {
  const { input, message, dispose } = mount({ hint: 'Optional' }, anInput());
  await tick();
  assert.ok(message!.id.length > 0);
  assert.equal(input!.getAttribute('aria-describedby'), message!.id);
  dispose();
});

test('respects a control that already has an id', async () => {
  const preset: HTMLInputElement = anInput();
  preset.id = 'my-input';
  const { label, dispose } = mount({ label: 'Name' }, preset);
  await tick();
  assert.equal(preset.id, 'my-input', 'existing id kept');
  assert.equal(label!.getAttribute('for'), 'my-input');
  dispose();
});

test('no message → no aria-describedby on the control', async () => {
  const { input, dispose } = mount({ label: 'Name' }, anInput());
  await tick();
  assert.ok(!input!.hasAttribute('aria-describedby'));
  dispose();
});

/* ─────────────────────────── error state ─────────────────────────── */

test('manual error: --invalid + error message + aria-invalid', async () => {
  const { root, input, message, dispose } = mount({ label: 'Email', error: 'Enter a valid email' }, anInput());
  assert.ok(root.classList.contains('weave-form-field--invalid'), '--invalid on the root');
  assert.equal(message?.textContent, 'Enter a valid email');
  assert.ok(message?.classList.contains('weave-form-field__error'), 'the error class');
  await tick();
  assert.equal(input!.getAttribute('aria-invalid'), 'true');
  dispose();
});

test('manual error overrides the hint', () => {
  const { message, dispose } = mount({ hint: 'Optional', error: 'Required' }, anInput());
  assert.equal(message?.textContent, 'Required');
  assert.ok(message?.classList.contains('weave-form-field__error'));
  dispose();
});

test('control-driven error appears only when touched AND invalid', async () => {
  const touched: Signal<boolean> = signal(false);
  const control: FormFieldControl = { touched: (): boolean => touched(), error: (): string | null => 'Required' };
  const { root, input, dispose } = mount({ label: 'Email', hint: 'Optional', control }, anInput());
  // untouched → hint, not error
  assert.ok(!root.classList.contains('weave-form-field--invalid'));
  assert.equal(root.querySelector('.weave-form-field__hint')?.textContent, 'Optional');
  await tick();
  assert.ok(!input!.hasAttribute('aria-invalid'));
  // touch it → error surfaces reactively
  touched.set(true);
  assert.ok(root.classList.contains('weave-form-field--invalid'), '--invalid after touch');
  assert.equal(root.querySelector('.weave-form-field__error')?.textContent, 'Required');
  await tick();
  assert.equal(input!.getAttribute('aria-invalid'), 'true');
  dispose();
});

test('a valid touched control shows no error', async () => {
  const control: FormFieldControl = { touched: (): boolean => true, error: (): string | null => null };
  const { root, input, dispose } = mount({ label: 'Email', hint: 'Optional', control }, anInput());
  assert.ok(!root.classList.contains('weave-form-field--invalid'));
  await tick();
  assert.ok(!input!.hasAttribute('aria-invalid'));
  dispose();
});

/* ─────────────────────────── forwarding ─────────────────────────── */

test('forwarded class is appended to the root', () => {
  const { root, dispose } = mount({ label: 'X', class: 'span-2' }, anInput());
  assert.ok(root.classList.contains('weave-form-field') && root.classList.contains('span-2'));
  dispose();
});
