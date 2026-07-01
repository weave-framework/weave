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
import { setup, template, type ListProps, type ListContext, type ListItem } from '@weave-framework/ui/list';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'host', 'items', 'listClass', 'listRole', 'rowRole', 'label',
  'ariaSelected', 'ariaDisabled', 'tabindexFor', 'activate', 'onKeydown',
];

function mount(props: ListProps): { list: HTMLElement; rows: HTMLElement[]; dispose: () => void } {
  const owner: Owner = createOwner();
  const list: HTMLElement = runInOwner(owner, () => {
    const ctx: ListContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(list);
  const rows: HTMLElement[] = Array.from(list.querySelectorAll<HTMLElement>('.weave-list__row'));
  return { list, rows, dispose: (): void => { disposeOwner(owner); list.remove(); } };
}

const ROWS: ListItem[] = [
  { value: 'apple', title: 'Apple', meta: 'fruit' },
  { value: 'banana', title: 'Banana', meta: 'fruit' },
  { value: 'cherry', title: 'Cherry' },
];
const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

/* ─────────────────────────── selectable (listbox) ─────────────────────────── */

test('selectable: renders a listbox of role=option rows with title + meta', () => {
  const { list, rows, dispose } = mount({ items: ROWS, value: 'apple' });
  assert.equal(list.getAttribute('role'), 'listbox');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.getAttribute('role') === 'option'), 'each row is an option');
  assert.equal(rows[0].querySelector('.weave-list__title')?.textContent, 'Apple');
  assert.equal(rows[0].querySelector('.weave-list__meta')?.textContent, 'fruit');
  dispose();
});

test('selectable: a row with no meta renders no __meta element', () => {
  const { rows, dispose } = mount({ items: ROWS, value: 'apple' });
  assert.equal(rows[2].querySelector('.weave-list__meta'), null, 'Cherry has no meta span');
  dispose();
});

test('selectable: the selected row carries aria-selected=true, others false', () => {
  const { rows, dispose } = mount({ items: ROWS, value: 'banana' });
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-selected')), ['false', 'true', 'false']);
  dispose();
});

test('selectable: roving tabindex — only the selected row is tabbable', () => {
  const { rows, dispose } = mount({ items: ROWS, value: 'cherry' });
  assert.deepEqual(rows.map((r) => r.getAttribute('tabindex')), ['-1', '-1', '0']);
  dispose();
});

test('selectable: with no value, the first enabled row is the tab stop', () => {
  const { rows, dispose } = mount({ items: ROWS, value: null });
  assert.deepEqual(rows.map((r) => r.getAttribute('tabindex')), ['0', '-1', '-1']);
  dispose();
});

test('selectable: clicking a row emits its value', () => {
  let got: string | undefined;
  const { rows, dispose } = mount({ items: ROWS, value: 'apple', onChange: (v) => (got = v) });
  rows[2].click();
  assert.equal(got, 'cherry');
  dispose();
});

test('selectable: clicking the already-selected row does not re-emit', () => {
  let calls: number = 0;
  const { rows, dispose } = mount({ items: ROWS, value: 'apple', onChange: () => (calls += 1) });
  rows[0].click();
  assert.equal(calls, 0, 'no onChange for a no-op selection');
  dispose();
});

test('selectable: ArrowDown moves focus but NOT selection (explicit selection)', () => {
  const emitted: string[] = [];
  const { list, rows, dispose } = mount({ items: ROWS, value: 'apple', onChange: (v) => emitted.push(v) });
  key(list, 'ArrowDown');
  assert.equal(document.activeElement, rows[1], 'focus moved to the second row');
  assert.equal(emitted.length, 0, 'no selection change on arrow');
  assert.equal(rows[0].getAttribute('aria-selected'), 'true', 'apple still selected');
  dispose();
});

test('selectable: Enter selects the focused row', () => {
  const value: Signal<string> = signal('apple');
  const emitted: string[] = [];
  const { list, rows, dispose } = mount({
    items: ROWS,
    get value() { return value(); },
    onChange: (v) => { emitted.push(v); value.set(v); },
  });
  key(list, 'ArrowDown'); // focus → banana
  key(rows[1], 'Enter');
  assert.equal(emitted.at(-1), 'banana');
  dispose();
});

test('selectable: Space selects the focused row', () => {
  const value: Signal<string> = signal('apple');
  const emitted: string[] = [];
  const { list, rows, dispose } = mount({
    items: ROWS,
    get value() { return value(); },
    onChange: (v) => { emitted.push(v); value.set(v); },
  });
  key(list, 'ArrowDown'); // focus → banana
  key(rows[1], ' ');
  assert.equal(emitted.at(-1), 'banana');
  dispose();
});

test('selectable: ArrowUp from the first row wraps to the last', () => {
  const { list, rows, dispose } = mount({ items: ROWS, value: 'apple' });
  key(list, 'ArrowUp');
  assert.equal(document.activeElement, rows[2], 'wrapped to Cherry');
  dispose();
});

test('selectable: Home / End jump to the first / last row', () => {
  const { list, rows, dispose } = mount({ items: ROWS, value: 'banana' });
  key(list, 'End');
  assert.equal(document.activeElement, rows[2], 'End → last');
  key(list, 'Home');
  assert.equal(document.activeElement, rows[0], 'Home → first');
  dispose();
});

test('selectable: typeahead focuses the next row whose title matches', () => {
  const { list, rows, dispose } = mount({ items: ROWS, value: null });
  key(list, 'c'); // Cherry
  assert.equal(document.activeElement, rows[2], 'typed "c" → Cherry');
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('selectable: Arrow skips a disabled row, which is not selectable', () => {
  const rowsData: ListItem[] = [
    { value: 'a', title: 'A' },
    { value: 'b', title: 'B', disabled: true },
    { value: 'c', title: 'C' },
  ];
  let got: string | undefined;
  const { list, rows, dispose } = mount({ items: rowsData, value: 'a', onChange: (v) => (got = v) });
  assert.equal(rows[1].getAttribute('aria-disabled'), 'true', 'disabled row is aria-disabled');
  assert.equal(rows[1].getAttribute('tabindex'), '-1', 'disabled row never tabbable');
  rows[1].click();
  assert.equal(got, undefined, 'clicking a disabled row does nothing');
  key(list, 'ArrowDown');
  assert.equal(document.activeElement, rows[2], 'a → c (b is skipped)');
  dispose();
});

test('list disabled: every row is aria-disabled and no row is tabbable', () => {
  const { rows, dispose } = mount({ items: ROWS, value: 'apple', disabled: true });
  assert.ok(rows.every((r) => r.getAttribute('aria-disabled') === 'true'), 'all rows disabled');
  assert.ok(rows.every((r) => r.getAttribute('tabindex') === '-1'), 'no tab stop');
  dispose();
});

/* ─────────────────────────── non-selectable (plain list) ─────────────────────────── */

test('non-selectable: renders role=list with role=listitem rows, no selection affordances', () => {
  const { list, rows, dispose } = mount({ items: ROWS, selectable: false, value: 'apple' });
  assert.equal(list.getAttribute('role'), 'list');
  assert.ok(rows.every((r) => r.getAttribute('role') === 'listitem'), 'rows are listitems');
  assert.ok(rows.every((r) => !r.hasAttribute('aria-selected')), 'no aria-selected');
  assert.ok(rows.every((r) => !r.hasAttribute('tabindex')), 'rows are not focusable');
  dispose();
});

test('non-selectable: clicking a row emits nothing and keyboard does not navigate', () => {
  let calls: number = 0;
  const { list, rows, dispose } = mount({ items: ROWS, selectable: false, onChange: () => (calls += 1) });
  rows[0].click();
  key(list, 'ArrowDown');
  assert.equal(calls, 0, 'a plain list is inert');
  dispose();
});

/* ─────────────────────────── a11y + forwarding ─────────────────────────── */

test('label sets the list aria-label', () => {
  const { list, dispose } = mount({ items: ROWS, value: 'apple', label: 'Fruits' });
  assert.equal(list.getAttribute('aria-label'), 'Fruits');
  dispose();
});

test('forwarded class is appended to the container', () => {
  const { list, dispose } = mount({ items: ROWS, value: 'apple', class: 'sidebar-list' });
  assert.ok(list.classList.contains('weave-list') && list.classList.contains('sidebar-list'));
  dispose();
});
