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
import { applyAction } from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import * as IconMod from '@weave-framework/ui/icon';
import { mask } from '@weave-framework/ui/cdk';
import { toComponent } from '../internal/compose.js';
import { setup, template, type InputProps, type InputContext, type InputControl } from '@weave-framework/ui/input';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount prefix/suffix collapse). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'root', 'input', 'revealBtn', 'rootClass', 'multiline', 'singleline', 'type', 'rows', 'placeholder', 'currentValue',
  'isDisabled', 'isReadonly', 'isRequired', 'name', 'label', 'showClear', 'clearLabel',
  'showReveal', 'revealIcon', 'revealAriaLabel', 'revealTitle', 'revealPressed', 'toggleReveal', 'onNativeInput', 'onBlur', 'clear',
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
    const render: RenderFn = make(ctx, rt, { Icon: toComponent(IconMod as never) });
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

/* ─────────────────────────── use:mask forwarding (FW-17) ─────────────────────────── */

/**
 * Mount a real `<Input>` and forward `use:mask` to its root the way the compiler does —
 * `applyAction(root, mask, () => spec)`. This exercises the full chain the skill example relies on,
 * including Input's own `.value` binding and `on:input` on the inner field, which a hand-built
 * wrapper in the cdk test cannot.
 */
function mountMasked(
  props: InputProps,
  spec: { value: Signal<string>; template?: string; numeric?: Parameters<typeof mask>[1]['numeric'] },
): { field: HTMLInputElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: InputContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    const el: HTMLElement = make(ctx, rt, { Icon: toComponent(IconMod as never) })(ctx, {});
    applyAction(el, mask as never, () => spec); // exactly what `<Input use:mask={{ spec }}>` compiles to
    return el;
  });
  document.body.appendChild(root);
  const field: HTMLInputElement = root.querySelector<HTMLInputElement>('.weave-input__field')!;
  return { field, dispose: (): void => { disposeOwner(owner); root.remove(); } };
}

test('use:mask on a real <Input> reaches the inner field and formats it (FW-17)', async () => {
  const value: Signal<string> = signal('');
  const { field, dispose } = mountMasked({}, { value, template: '(999) 999-9999' });
  await tick(); // applyAction defers to onMount
  type(field, '370');
  assert.equal(field.value, '(370) ___-____', "Input's own .value binding does not clobber the mask");
  assert.equal(value(), '370');
  dispose();
});

test('use:mask numeric on a real <Input> — the skill example (FW-17)', async () => {
  const value: Signal<string> = signal('');
  const { field, dispose } = mountMasked({}, { value, numeric: { decimals: 2, decimalSeparator: ',', groupSeparator: '.' } });
  await tick();
  type(field, '1050');
  assert.equal(field.value, '10,50');
  assert.equal(value(), '10.50');
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

/* ─────────────────────────── password reveal ─────────────────────────── */

test('revealable: the eye toggle renders only for a password field with revealable', () => {
  const plain: Mounted = mount({ type: 'password' });
  assert.equal(plain.root.querySelector('.weave-input__reveal'), null, 'no toggle without revealable');
  plain.dispose();

  const text: Mounted = mount({ type: 'text', revealable: true });
  assert.equal(text.root.querySelector('.weave-input__reveal'), null, 'no toggle on a non-password field');
  text.dispose();

  const pw: Mounted = mount({ type: 'password', revealable: true });
  assert.ok(pw.root.querySelector('.weave-input__reveal'), 'password + revealable renders the toggle');
  assert.ok(pw.root.querySelector('.weave-icon'), 'the composed <Icon> rendered inside it');
  pw.dispose();
});

test('revealable: clicking the eye flips type password↔text with aria-pressed + label', () => {
  const { root, field, dispose } = mount({ type: 'password', revealable: true });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.equal(field.type, 'password', 'starts hidden');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Show password');

  btn.click();
  assert.equal(field.type, 'text', 'revealed → plaintext');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Hide password');

  btn.click();
  assert.equal(field.type, 'password', 'toggles back to hidden');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  dispose();
});

test('revealable: the toggle is type=button (never submits its form)', () => {
  const { root, dispose } = mount({ type: 'password', revealable: true });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.equal(btn.getAttribute('type'), 'button', 'a reveal click must not submit the surrounding form');
  dispose();
});

test('revealable: reveal/hide labels are overridable (i18n)', () => {
  const { root, dispose } = mount({ type: 'password', revealable: true, revealLabel: 'Rodyti', hideLabel: 'Slėpti' });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.equal(btn.getAttribute('aria-label'), 'Rodyti', 'custom show label');
  btn.click();
  assert.equal(btn.getAttribute('aria-label'), 'Slėpti', 'custom hide label after reveal');
  dispose();
});

test('revealable: a native title tooltip is on by default and follows the state (FW-5)', () => {
  const { root, dispose } = mount({ type: 'password', revealable: true, revealLabel: 'Rodyti', hideLabel: 'Slėpti' });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.equal(btn.getAttribute('title'), 'Rodyti', 'title shows the localized show-label by default');
  assert.equal(btn.getAttribute('aria-label'), 'Rodyti', 'aria-label (accessible name) unchanged');
  btn.click();
  assert.equal(btn.getAttribute('title'), 'Slėpti', 'title follows the revealed state');
  assert.equal(btn.getAttribute('aria-label'), 'Slėpti', 'aria-label still present alongside title');
  dispose();
});

test('revealable: onRevealToggle fires with the new state on each toggle', () => {
  const states: boolean[] = [];
  const { root, dispose } = mount({ type: 'password', revealable: true, onRevealToggle: (r) => states.push(r) });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.deepEqual(states, [], 'not called before any interaction');
  btn.click();
  assert.deepEqual(states, [true], 'fires true when the value becomes visible');
  btn.click();
  assert.deepEqual(states, [true, false], 'fires false when hidden again');
  dispose();
});

test('revealable: revealTooltip={{false}} suppresses the title but keeps aria-label', () => {
  const { root, dispose } = mount({ type: 'password', revealable: true, revealTooltip: false });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.ok(!btn.hasAttribute('title'), 'no native title when the app opts out');
  assert.equal(btn.getAttribute('aria-label'), 'Show password', 'aria-label (accessible name) stays');
  dispose();
});

/* ─────────────────────────── FW-6: selectable tooltip type ─────────────────────────── */

/** Flush the onMount microtask + the lazy `import()` of the weave Tooltip. */
const settle = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

test('revealTooltip normalises: true/"native"/omitted → native title, false/"none" → nothing (FW-6)', () => {
  const cases: Array<[InputProps['revealTooltip'], boolean]> = [
    [undefined, true], [true, true], ['native', true],
    [false, false], ['none', false],
  ];
  for (const [mode, hasTitle] of cases) {
    const { root, dispose } = mount({ type: 'password', revealable: true, revealTooltip: mode });
    const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
    assert.equal(btn.hasAttribute('title'), hasTitle, `title presence for revealTooltip=${String(mode)}`);
    assert.equal(btn.getAttribute('aria-label'), 'Show password', `aria-label present for revealTooltip=${String(mode)}`);
    dispose();
  }
});

test('revealTooltip="native": title follows the hidden↔revealed state (FW-6)', () => {
  const { root, dispose } = mount({ type: 'password', revealable: true, revealTooltip: 'native', revealLabel: 'Rodyti', hideLabel: 'Slėpti' });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.equal(btn.getAttribute('title'), 'Rodyti');
  btn.click();
  assert.equal(btn.getAttribute('title'), 'Slėpti', 'native title tracks state');
  dispose();
});

test('revealTooltip="none": neither native title nor a weave bubble (FW-6)', async () => {
  const { root, dispose } = mount({ type: 'password', revealable: true, revealTooltip: 'none' });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.ok(!btn.hasAttribute('title'), 'no native title');
  await settle();
  btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  assert.equal(document.querySelector('.weave-tooltip'), null, 'no weave bubble in none mode');
  assert.equal(btn.getAttribute('aria-label'), 'Show password', 'aria-label still present');
  dispose();
});

test('revealTooltip="weave": renders the weave Tooltip (no title), text follows state (FW-6)', async () => {
  const { root, dispose } = mount({
    type: 'password', revealable: true, revealTooltip: 'weave', revealLabel: 'Rodyti', hideLabel: 'Slėpti',
  });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  assert.ok(!btn.hasAttribute('title'), 'no native title in weave mode (its own bubble instead)');
  assert.equal(btn.getAttribute('aria-label'), 'Rodyti', 'aria-label (accessible name) present');

  await settle(); // onMount + lazy import() of the Tooltip action resolve
  btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); // focus shows immediately (no hover delay)
  const tip: Element | null = document.querySelector('.weave-tooltip');
  assert.ok(tip, 'weave bubble shown on keyboard focus');
  assert.equal(tip!.getAttribute('role'), 'tooltip', 'the bubble is role=tooltip');
  assert.equal(tip!.textContent, 'Rodyti', 'bubble text = current (show) label');

  btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  btn.click(); // revealed → the label flips to hide; the tooltip re-applies with the new text
  await settle();
  btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const tip2: Element | null = document.querySelector('.weave-tooltip');
  assert.ok(tip2, 'bubble shows again after toggle');
  assert.equal(tip2!.textContent, 'Slėpti', 'bubble text follows the revealed state');
  dispose();
});

test('revealTooltip="weave": onRevealToggle still fires, and disposing removes the bubble (FW-6)', async () => {
  const states: boolean[] = [];
  const { root, dispose } = mount({
    type: 'password', revealable: true, revealTooltip: 'weave', onRevealToggle: (r) => states.push(r),
  });
  const btn: HTMLButtonElement = root.querySelector<HTMLButtonElement>('.weave-input__reveal')!;
  await settle();
  btn.click();
  assert.deepEqual(states, [true], 'onRevealToggle unaffected by weave mode');
  btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  assert.ok(document.querySelector('.weave-tooltip'), 'bubble present while mounted');
  dispose();
  assert.equal(document.querySelector('.weave-tooltip'), null, 'bubble torn down on dispose');
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
