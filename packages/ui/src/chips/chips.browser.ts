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
import { setup, template, type ChipsProps, type ChipsContext, type ChipsControl } from '@weave-framework/ui/chips';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'root', 'chips', 'groupClass', 'label', 'removable', 'isDisabled', 'tabindexFor',
  'removeLabelFor', 'removeChip', 'onKeydown', 'showAdd', 'add', 'addText',
];

function mount(props: ChipsProps): { group: HTMLElement; chips: () => HTMLElement[]; removes: () => HTMLButtonElement[]; dispose: () => void } {
  const owner: Owner = createOwner();
  const group: HTMLElement = runInOwner(owner, () => {
    const ctx: ChipsContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(group);
  return {
    group,
    chips: (): HTMLElement[] => Array.from(group.querySelectorAll<HTMLElement>('.weave-chips__chip:not(.weave-chips__chip--add)')),
    removes: (): HTMLButtonElement[] => Array.from(group.querySelectorAll<HTMLButtonElement>('.weave-chips__remove')),
    dispose: (): void => { disposeOwner(owner); group.remove(); },
  };
}

const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

type TestControl = ChipsControl & { value: Signal<string[]>; touched: Signal<boolean> };
function makeControl(initial: string[]): TestControl {
  return { value: signal(initial), touched: signal(false), error: (): string | null => null };
}

/* ─────────────────────────── structure ─────────────────────────── */

test('renders a group of chips with labels and remove buttons', () => {
  const { group, chips, removes, dispose } = mount({ value: ['red', 'green', 'blue'] });
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(chips().length, 3);
  assert.deepEqual(chips().map((c) => c.querySelector('.weave-chips__label')?.textContent), ['red', 'green', 'blue']);
  assert.equal(removes().length, 3, 'each chip has a × button');
  dispose();
});

test('removable={false} hides the × buttons', () => {
  const { removes, dispose } = mount({ value: ['a'], removable: false });
  assert.equal(removes().length, 0);
  dispose();
});

test('the remove button carries an aria-label', () => {
  const { removes, dispose } = mount({ value: ['react'] });
  assert.equal(removes()[0].getAttribute('aria-label'), 'Remove react');
  dispose();
});

/* ─────────────────────────── removal (two-way) ─────────────────────────── */

test('clicking × removes that chip and emits the shorter array', () => {
  const value: Signal<string[]> = signal(['a', 'b', 'c']);
  const { removes, dispose } = mount({ get value() { return value(); }, onChange: (v) => value.set(v) });
  removes()[1].click();
  assert.deepEqual(value(), ['a', 'c'], 'b removed');
  dispose();
});

test('Backspace removes the focused chip', () => {
  const value: Signal<string[]> = signal(['a', 'b', 'c']);
  const { group, dispose } = mount({ get value() { return value(); }, onChange: (v) => value.set(v) });
  key(group, 'ArrowRight'); // focus → index 1 (b)
  key(group, 'Backspace');
  assert.deepEqual(value(), ['a', 'c'], 'the focused chip (b) is removed');
  dispose();
});

test('Delete removes the focused chip', () => {
  const value: Signal<string[]> = signal(['a', 'b']);
  const { group, dispose } = mount({ get value() { return value(); }, onChange: (v) => value.set(v) });
  key(group, 'Delete'); // active seeds to 0 (a)
  assert.deepEqual(value(), ['b']);
  dispose();
});

/* ─────────────────────────── keyboard nav ─────────────────────────── */

test('roving tabindex — only the first chip is tabbable initially', () => {
  const { chips, dispose } = mount({ value: ['a', 'b', 'c'] });
  assert.deepEqual(chips().map((c) => c.getAttribute('tabindex')), ['0', '-1', '-1']);
  dispose();
});

test('ArrowRight moves focus to the next chip', () => {
  const { group, chips, dispose } = mount({ value: ['a', 'b', 'c'] });
  key(group, 'ArrowRight');
  assert.equal(document.activeElement, chips()[1]);
  key(group, 'ArrowRight');
  assert.equal(document.activeElement, chips()[2]);
  dispose();
});

/* ─────────────────────────── forms control ─────────────────────────── */

test('control: removing updates the field array two-way and touches it', () => {
  const control: TestControl = makeControl(['x', 'y']);
  const { removes, dispose } = mount({ control });
  removes()[0].click();
  assert.deepEqual(control.value(), ['y']);
  assert.equal(control.touched(), true, 'removal marks touched');
  dispose();
});

test('control wins over value/onChange', () => {
  const control: TestControl = makeControl(['keep']);
  let onChangeCalls: number = 0;
  const { chips, removes, dispose } = mount({ control, value: ['ignored'], onChange: () => (onChangeCalls += 1) });
  assert.deepEqual(chips().map((c) => c.querySelector('.weave-chips__label')?.textContent), ['keep']);
  removes()[0].click();
  assert.equal(onChangeCalls, 0, 'onChange bypassed when a control is bound');
  assert.deepEqual(control.value(), []);
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('disabled: chips are not tabbable, the × is disabled, and removal is inert', () => {
  const value: Signal<string[]> = signal(['a', 'b']);
  const { group, chips, removes, dispose } = mount({ get value() { return value(); }, onChange: (v) => value.set(v), disabled: true });
  assert.ok(chips().every((c) => c.getAttribute('tabindex') === '-1'), 'no tab stop');
  assert.ok(removes().every((r) => r.disabled), 'remove buttons disabled');
  removes()[0].click();
  key(group, 'Backspace');
  assert.deepEqual(value(), ['a', 'b'], 'nothing removed while disabled');
  dispose();
});

/* ─────────────────────────── add chip ─────────────────────────── */

test('onAdd renders a dashed "+ Add" chip that fires on click', () => {
  let added: number = 0;
  const { group, dispose } = mount({ value: ['a'], onAdd: () => (added += 1), addLabel: 'Tag' });
  const add: HTMLButtonElement | null = group.querySelector('.weave-chips__chip--add');
  assert.ok(add, 'the add chip is rendered');
  assert.equal(add!.textContent, '+ Tag');
  add!.click();
  assert.equal(added, 1);
  dispose();
});

test('no onAdd → no add chip', () => {
  const { group, dispose } = mount({ value: ['a'] });
  assert.equal(group.querySelector('.weave-chips__chip--add'), null);
  dispose();
});

/* ─────────────────────────── a11y + forwarding ─────────────────────────── */

test('label sets the group aria-label', () => {
  const { group, dispose } = mount({ value: ['a'], label: 'Tags' });
  assert.equal(group.getAttribute('aria-label'), 'Tags');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { group, dispose } = mount({ value: ['a'], class: 'tag-row' });
  assert.ok(group.classList.contains('weave-chips') && group.classList.contains('tag-row'));
  dispose();
});
