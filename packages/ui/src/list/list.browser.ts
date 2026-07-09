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
  type ListProps,
  type ListContext,
  type ListItem,
  type ListRowContext,
} from '@weave-framework/ui/list';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'host', 'items', 'listClass', 'listRole', 'rowRole', 'reorderable', 'hasTemplate', 'label',
  'ariaSelected', 'ariaDisabled', 'tabindexFor', 'rowKey', 'rowBody', 'activate', 'onKeydown',
];
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

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

/* ─────────────────────────── reorder (CDK dropList) ─────────────────────────── */

const dragPointer = (target: EventTarget, type: string, clientY: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY }));
};

test('reorderable: renders a drag handle per row + a --reorderable class', async () => {
  const { list, rows, dispose } = mount({ items: ROWS, reorderable: true });
  await tick(); // onMount attaches the dropList
  assert.ok(list.classList.contains('weave-list--reorderable'));
  assert.ok(rows.every((r) => r.querySelector('.weave-list__drag-handle')), 'each row has a handle');
  dispose();
});

test('reorderable: dragging a row handle past a sibling midpoint emits onReorder', async () => {
  const drops: Array<{ previousIndex: number; currentIndex: number }> = [];
  const { list, rows, dispose } = mount({ items: ROWS, reorderable: true, onReorder: (e) => drops.push(e) });
  await tick();
  const handle0: HTMLElement = rows[0].querySelector('.weave-list__drag-handle') as HTMLElement;
  const r1: DOMRect = rows[1].getBoundingClientRect();
  const pastRow1: number = r1.top + r1.height / 2 + 1; // just past row 1's midpoint
  dragPointer(handle0, 'pointerdown', rows[0].getBoundingClientRect().top + 4);
  dragPointer(list, 'pointermove', pastRow1);
  dragPointer(list, 'pointerup', pastRow1);
  assert.deepEqual(drops.at(-1), { previousIndex: 0, currentIndex: 1 }, 'moved item 0 to index 1');
  dispose();
});

test('reorderable: a row-body click still selects (only the handle drags)', async () => {
  let selected: string | undefined;
  const { rows, dispose } = mount({ items: ROWS, reorderable: true, value: null, onChange: (v) => (selected = v) });
  await tick();
  rows[1].click(); // click on the row body, not the handle
  assert.equal(selected, 'banana', 'row click selects; the handle is the only drag start');
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

/* ─────────────────────────── FW-14 · rowTemplate ─────────────────────────── */

interface Role { name: string; color: string; users: number }
const ROLE_ROWS: ListItem<Role>[] = [
  { value: 'admin', title: 'Admin', data: { name: 'Admin', color: '#e11', users: 3 } },
  { value: 'editor', title: 'Editor', data: { name: 'Editor', color: '#1a7', users: 9 } },
  { value: 'viewer', title: 'Viewer', data: { name: 'Viewer', color: '#37f', users: 42 } },
];
/** A plain-JS row factory (stands in for a compiled `@snippet`): a main block (dot + name + a
 *  count pill) growing, plus a trailing action button — a fragment of two flex children. */
const roleRow = (row: ListRowContext<Role>): Node => {
  const frag: DocumentFragment = document.createDocumentFragment();
  const main: HTMLElement = document.createElement('div');
  main.className = 'list-item-main';
  main.dataset.idx = String(row.index);
  if (row.selected) main.classList.add('is-sel');
  const dot: HTMLElement = document.createElement('span');
  dot.className = 'role-dot';
  dot.dataset.color = row.data?.color ?? '';
  const name: HTMLElement = document.createElement('span');
  name.className = 'name';
  name.textContent = row.data?.name ?? row.title;
  const pill: HTMLElement = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = String(row.data?.users ?? 0);
  main.append(dot, name, pill);
  const actions: HTMLElement = document.createElement('div');
  actions.className = 'list-item-actions';
  const edit: HTMLButtonElement = document.createElement('button');
  edit.type = 'button';
  edit.className = 'act act-edit';
  edit.textContent = 'edit';
  actions.append(edit);
  frag.append(main, actions);
  return frag;
};

test('rowTemplate renders the whole row body — dot + name + pill + action — replacing title/meta spans (FW-14)', async () => {
  const { rows, dispose } = mount({ items: ROLE_ROWS, rowTemplate: roleRow } as ListProps);
  await tick();
  rows.forEach((row, i) => {
    assert.ok(row.querySelector('.list-item-main'), `row ${i} has the custom template body`);
    assert.equal(row.querySelector('.name')?.textContent, ROLE_ROWS[i].data!.name, 'name from row.data');
    assert.equal(row.querySelector('.role-dot')?.getAttribute('data-color'), ROLE_ROWS[i].data!.color, 'dot colour from row.data');
    assert.equal(row.querySelector('.pill')?.textContent, String(ROLE_ROWS[i].data!.users), 'pill count from row.data');
    assert.equal(row.querySelector('.weave-list__title'), null, 'default title span NOT rendered when templated');
    assert.equal(row.querySelector('.weave-list__meta'), null, 'default meta span NOT rendered when templated');
  });
  dispose();
});

test('rowTemplate: framework still owns role / aria-selected / roving tabindex (FW-14)', async () => {
  const { rows, dispose } = mount({ items: ROLE_ROWS, rowTemplate: roleRow, value: 'editor' } as ListProps);
  await tick();
  assert.ok(rows.every((r) => r.getAttribute('role') === 'option'), 'rows keep option role under a template');
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-selected')), ['false', 'true', 'false'], 'framework selection unaffected');
  assert.deepEqual(rows.map((r) => r.getAttribute('tabindex')), ['-1', '0', '-1'], 'roving tab stop unaffected');
  dispose();
});

test('rowTemplate: title still drives typeahead (accessible name unaffected) (FW-14)', async () => {
  const { list, rows, dispose } = mount({ items: ROLE_ROWS, rowTemplate: roleRow, value: null } as ListProps);
  await tick();
  key(list, 'v'); // Viewer — matches item.title even though no title span is in the DOM
  assert.equal(document.activeElement, rows[2], 'typeahead still targets the row by its title');
  dispose();
});

test('no rowTemplate → default title + meta spans (back-compatible) (FW-14)', () => {
  const { rows, dispose } = mount({ items: ROWS, value: 'apple' });
  assert.equal(rows[0].querySelector('.weave-list__title')?.textContent, 'Apple', 'default title span rendered');
  assert.equal(rows[0].querySelector('.weave-list__meta')?.textContent, 'fruit', 'default meta span rendered');
  dispose();
});

test('rowTemplate row context: item / value / title / data / index / selected / disabled are correct (FW-14)', async () => {
  const seen: ListRowContext<Role>[] = [];
  const rowsData: ListItem<Role>[] = [
    { value: 'admin', title: 'Admin', data: { name: 'Admin', color: '#e11', users: 3 } },
    { value: 'editor', title: 'Editor', disabled: true, data: { name: 'Editor', color: '#1a7', users: 9 } },
  ];
  const capture = (row: ListRowContext<Role>): Node => { seen.push({ ...row }); return roleRow(row); };
  const { dispose } = mount({ items: rowsData, rowTemplate: capture, value: 'admin' } as ListProps);
  await tick();
  const r0: ListRowContext<Role> = seen.find((r) => r.index === 0)!;
  const r1: ListRowContext<Role> = seen.find((r) => r.index === 1)!;
  assert.equal(r0.value, 'admin');
  assert.equal(r0.title, 'Admin');
  assert.equal(r0.data?.users, 3, 'item.data reaches the template');
  assert.equal(r0.selected, true, 'admin is the selected row');
  assert.equal(r0.disabled, false);
  assert.equal(r1.selected, false);
  assert.equal(r1.disabled, true, 'disabled row reported to the template');
  dispose();
});

test('rowTemplate is reactive: selecting a row re-renders it with the new selected state (FW-14)', async () => {
  const value: Signal<string> = signal('admin');
  const { rows, dispose } = mount({
    items: ROLE_ROWS,
    rowTemplate: roleRow,
    get value() { return value(); },
    onChange: (v) => value.set(v),
  } as ListProps);
  await tick();
  assert.ok(rows[0].querySelector('.list-item-main')?.classList.contains('is-sel'), 'admin template is-sel on mount');
  assert.ok(!rows[2].querySelector('.list-item-main')?.classList.contains('is-sel'), 'viewer not selected');
  rows[2].click();
  await tick();
  assert.ok(!rows[0].querySelector('.list-item-main')?.classList.contains('is-sel'), 'admin no longer selected in template');
  assert.ok(rows[2].querySelector('.list-item-main')?.classList.contains('is-sel'), 'selected state moved to the clicked row');
  dispose();
});

test('rowTemplate rows are torn down on unmount — no re-render after dispose (FW-14)', async () => {
  const value: Signal<string> = signal('admin');
  let renders: number = 0;
  const counting = (row: ListRowContext<Role>): Node => { renders += 1; return roleRow(row); };
  const { dispose } = mount({
    items: ROLE_ROWS,
    rowTemplate: counting,
    get value() { return value(); },
    onChange: (v) => value.set(v),
  } as ListProps);
  await tick();
  const afterMount: number = renders;
  assert.ok(afterMount >= 3, 'each row rendered once on mount');
  dispose();
  value.set('viewer'); // would re-run a live row effect; must be a no-op after dispose
  await tick();
  assert.equal(renders, afterMount, 'no row re-render after dispose (owner torn down)');
});

test('rowTemplate + reorderable: the drag handle stays before the template content (FW-14)', async () => {
  const { rows, dispose } = mount({ items: ROLE_ROWS, rowTemplate: roleRow, reorderable: true } as ListProps);
  await tick();
  rows.forEach((row, i) => {
    const handle: Element | null = row.querySelector('.weave-list__drag-handle');
    assert.ok(handle, `row ${i} keeps its drag handle`);
    assert.equal(row.firstElementChild, handle, 'handle is the first child (before the template body)');
    assert.ok(row.querySelector('.list-item-main'), 'template body still rendered alongside the handle');
  });
  dispose();
});

test('rowTemplate: a click on an interactive child (a Button inside the row) does NOT select the row (FW-14)', async () => {
  let selected: string | undefined;
  const { rows, dispose } = mount({ items: ROLE_ROWS, rowTemplate: roleRow, value: null, onChange: (v) => (selected = v) } as ListProps);
  await tick();
  (rows[1].querySelector('.act-edit') as HTMLButtonElement).click(); // click the row's action button
  assert.equal(selected, undefined, 'the button click did not toggle row selection');
  rows[1].click(); // a click on the row body still selects
  assert.equal(selected, 'editor', 'a plain row-body click still selects');
  dispose();
});

test('non-selectable + rowTemplate: rows render the template and stay inert (FW-14)', async () => {
  let calls: number = 0;
  const { list, rows, dispose } = mount({ items: ROLE_ROWS, selectable: false, rowTemplate: roleRow, onChange: () => (calls += 1) } as ListProps);
  await tick();
  assert.ok(rows.every((r) => r.getAttribute('role') === 'listitem'), 'plain list rows under a template');
  assert.ok(rows.every((r) => r.querySelector('.list-item-main')), 'template body rendered in every row');
  rows[0].click();
  assert.equal(calls, 0, 'a non-selectable list is inert even with a template');
  dispose();
});

/* ── FW-14 · rowTemplate over DYNAMIC items (async load / append / reload) ── */

const names = (list: HTMLElement): (string | undefined)[] =>
  Array.from(list.querySelectorAll<HTMLElement>('.weave-list__row')).map((r) => r.querySelector('.name')?.textContent ?? undefined);

test('rowTemplate: rows loaded ASYNC (after mount) get their template body (FW-14 dynamic)', async () => {
  const data: Signal<ListItem<Role>[]> = signal([]);
  const { list, dispose } = mount({ selectable: false, get items() { return data(); }, rowTemplate: roleRow } as ListProps);
  await tick();
  assert.equal(list.querySelectorAll('.weave-list__row').length, 0, 'no rows before the fetch resolves');
  data.set(ROLE_ROWS); // fetch resolves AFTER <List> mounted
  await tick();
  assert.deepEqual(names(list), ['Admin', 'Editor', 'Viewer'], 'every async-loaded row rendered its body');
  dispose();
});

test('rowTemplate: appended rows (infinite scroll loadMore) get their body (FW-14 dynamic)', async () => {
  const data: Signal<ListItem<Role>[]> = signal([ROLE_ROWS[0]]);
  const { list, dispose } = mount({ selectable: false, get items() { return data(); }, rowTemplate: roleRow } as ListProps);
  await tick();
  assert.deepEqual(names(list), ['Admin'], 'first page rendered');
  data.set([...data(), ROLE_ROWS[1], ROLE_ROWS[2]]); // loadMore() pushes a page
  await tick();
  assert.deepEqual(names(list), ['Admin', 'Editor', 'Viewer'], 'appended rows filled their bodies');
  dispose();
});

test('rowTemplate: reload replaces rows and re-renders bodies (FW-14 dynamic)', async () => {
  const data: Signal<ListItem<Role>[]> = signal(ROLE_ROWS);
  const { list, dispose } = mount({ selectable: false, get items() { return data(); }, rowTemplate: roleRow } as ListProps);
  await tick();
  assert.deepEqual(names(list), ['Admin', 'Editor', 'Viewer']);
  const fresh: ListItem<Role>[] = [{ value: 'owner', title: 'Owner', data: { name: 'Owner', color: '#000', users: 1 } }];
  data.set(fresh); // create/edit/delete → reload with a new list
  await tick();
  assert.deepEqual(names(list), ['Owner'], 'reloaded row rendered its body');
  dispose();
});
