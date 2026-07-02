import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { ArrayDataSource } from '@weave-framework/ui/cdk';
import { setup, template, type TableProps, type TableContext, type SortState, type TableColumn } from '@weave-framework/ui/table';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const SCOPE: string[] = ['host', 'rootClass'];

type MakeRender = (ctx: TableContext, rt: unknown, c: unknown) => (ctx: TableContext, slots: Record<string, () => Node>) => HTMLElement;

interface Row {
  id: number;
  name: string;
  age: number;
}
const ROWS: Row[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Alan', age: 41 },
  { id: 3, name: 'Grace', age: 28 },
];
const COLS: TableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'age', header: 'Age', sortable: true, numeric: true },
];

interface Mounted {
  host: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

async function mount<T>(props: TableProps<T>): Promise<Mounted> {
  const owner: Owner = createOwner();
  const host: HTMLElement = runInOwner(owner, () => {
    const ctx: TableContext = setup<T>(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    return make(ctx, rt, {})(ctx, {});
  });
  document.body.appendChild(host);
  await tick(); // onMount builds the <table>
  return {
    host,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      host.remove();
    },
  };
}

const bodyRows = (m: Mounted): HTMLTableRowElement[] =>
  Array.from(m.host.querySelectorAll<HTMLTableRowElement>('tbody tr.weave-table__row'));
const dataCellText = (tr: HTMLElement): string[] =>
  Array.from(tr.querySelectorAll<HTMLElement>('.weave-table__cell'))
    .filter((c) => !c.classList.contains('weave-table__select') && !c.classList.contains('weave-table__expand'))
    .map((c) => c.textContent ?? '');
const headerButtons = (m: Mounted): HTMLButtonElement[] =>
  Array.from(m.host.querySelectorAll<HTMLButtonElement>('.weave-table__sort'));

/* ── structure ── */
test('table: renders a real <table> with thead/tbody, columns + rows', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS });
  assert.ok(m.host.querySelector('table.weave-table__grid'), 'a real <table>');
  const ths: NodeListOf<HTMLElement> = m.host.querySelectorAll('thead th[scope="col"]');
  assert.equal(ths.length, 2, 'two column headers');
  assert.equal(bodyRows(m).length, 3);
  assert.deepEqual(dataCellText(bodyRows(m)[0]), ['Ada', '36']);
  m.dispose();
});

test('table: a node cell renders the returned element', async () => {
  const cols: TableColumn<Row>[] = [
    { key: 'name', header: 'Name' },
    {
      key: 'age',
      header: 'Age',
      cell: (r: Row): Node => {
        const b: HTMLElement = document.createElement('strong');
        b.className = 'age-badge';
        b.textContent = String(r.age);
        return b;
      },
    },
  ];
  const m: Mounted = await mount<Row>({ columns: cols, dataSource: ROWS });
  const badge: Element | null = bodyRows(m)[0].querySelector('.age-badge');
  assert.ok(badge, 'node cell mounted');
  assert.equal(badge!.textContent, '36');
  m.dispose();
});

test('table: empty data shows the empty row with the given text', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: [], emptyText: 'Nothing here' });
  assert.equal(bodyRows(m).length, 0);
  const empty: Element | null = m.host.querySelector('.weave-table__empty');
  assert.ok(empty);
  assert.equal(empty!.textContent, 'Nothing here');
  m.dispose();
});

/* ── sort ── */
test('table: clicking a sortable header cycles asc→desc→none + emits onSort + client-sorts', async () => {
  const emitted: SortState[] = [];
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS, onSort: (s) => emitted.push(s) });
  const ageBtn: HTMLButtonElement = headerButtons(m)[1]; // Age
  ageBtn.click(); // asc
  assert.deepEqual(emitted.at(-1), { active: 'age', direction: 'asc' });
  assert.deepEqual(
    bodyRows(m).map((r) => dataCellText(r)[0]),
    ['Grace', 'Ada', 'Alan'],
    'sorted by age asc',
  );
  const th: HTMLElement = m.host.querySelectorAll('thead th')[1] as HTMLElement;
  assert.equal(th.getAttribute('aria-sort'), 'ascending');
  ageBtn.click(); // desc
  assert.deepEqual(emitted.at(-1), { active: 'age', direction: 'desc' });
  assert.deepEqual(bodyRows(m).map((r) => dataCellText(r)[0]), ['Alan', 'Ada', 'Grace']);
  ageBtn.click(); // none
  assert.deepEqual(emitted.at(-1), { active: null, direction: null });
  assert.deepEqual(bodyRows(m).map((r) => dataCellText(r)[0]), ['Ada', 'Alan', 'Grace'], 'back to source order');
  m.dispose();
});

test('table: disableClear keeps asc↔desc (never clears)', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS, disableClear: true });
  const btn: HTMLButtonElement = headerButtons(m)[0];
  btn.click(); // asc
  btn.click(); // desc
  btn.click(); // asc again (not none)
  const th: HTMLElement = m.host.querySelectorAll('thead th')[0] as HTMLElement;
  assert.equal(th.getAttribute('aria-sort'), 'ascending');
  m.dispose();
});

/* ── selection ── */
test('table: selectable adds a checkbox column; toggling a row selects it', async () => {
  const changes: Row[][] = [];
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS, selectable: true, onSelectionChange: (s) => changes.push(s) });
  const first: HTMLTableRowElement = bodyRows(m)[0];
  const cb: HTMLInputElement = first.querySelector('.weave-table__checkbox') as HTMLInputElement;
  cb.click();
  assert.equal(first.getAttribute('aria-selected'), 'true');
  assert.equal(changes.at(-1)?.length, 1);
  assert.equal(changes.at(-1)?.[0].id, 1);
  m.dispose();
});

test('table: header select-all toggles all rows + goes indeterminate on a partial set', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS, selectable: true });
  const all: HTMLInputElement = m.host.querySelector('thead .weave-table__checkbox') as HTMLInputElement;
  all.click(); // select all
  assert.ok(bodyRows(m).every((r) => r.getAttribute('aria-selected') === 'true'), 'all selected');
  assert.equal(all.checked, true);
  // deselect one → indeterminate
  const oneCb: HTMLInputElement = bodyRows(m)[0].querySelector('.weave-table__checkbox') as HTMLInputElement;
  oneCb.click();
  assert.equal(all.indeterminate, true, 'partial → indeterminate');
  assert.equal(all.checked, false);
  m.dispose();
});

test('table: single selection mode replaces', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS, selectable: true, selectionMode: 'single' });
  const cbs: HTMLInputElement[] = bodyRows(m).map((r) => r.querySelector('.weave-table__checkbox') as HTMLInputElement);
  cbs[0].click();
  cbs[1].click();
  assert.equal(bodyRows(m)[0].getAttribute('aria-selected'), 'false');
  assert.equal(bodyRows(m)[1].getAttribute('aria-selected'), 'true');
  assert.ok(!m.host.querySelector('thead .weave-table__checkbox'), 'no select-all in single mode');
  m.dispose();
});

/* ── expandable ── */
test('table: expandable toggles a detail row + aria-expanded', async () => {
  const m: Mounted = await mount<Row>({
    columns: COLS,
    dataSource: ROWS,
    expandable: true,
    detail: (r) => `Detail for ${r.name}`,
  });
  const toggle: HTMLButtonElement = bodyRows(m)[0].querySelector('.weave-table__expand-toggle') as HTMLButtonElement;
  const detail: HTMLElement = m.host.querySelector('.weave-table__detail') as HTMLElement;
  assert.ok(detail.hidden, 'detail hidden initially');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.ok(!detail.hidden, 'detail shown after toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal((detail.querySelector('.weave-table__detail-cell') as HTMLElement).textContent, 'Detail for Ada');
  m.dispose();
});

/* ── show / hide ── */
test('table: a hidden column is not rendered', async () => {
  const cols: TableColumn<Row>[] = [
    { key: 'name', header: 'Name' },
    { key: 'age', header: 'Age', hidden: true },
  ];
  const m: Mounted = await mount<Row>({ columns: cols, dataSource: ROWS });
  assert.equal(m.host.querySelectorAll('thead th[scope="col"]').length, 1);
  assert.deepEqual(dataCellText(bodyRows(m)[0]), ['Ada']);
  m.dispose();
});

/* ── sticky columns ── */
test('table: a sticky column gets the sticky class + an inline offset', async () => {
  const cols: TableColumn<Row>[] = [
    { key: 'name', header: 'Name', sticky: 'start' },
    { key: 'age', header: 'Age', numeric: true },
  ];
  const m: Mounted = await mount<Row>({ columns: cols, dataSource: ROWS });
  const firstHead: HTMLElement = m.host.querySelector('thead th') as HTMLElement;
  assert.ok(firstHead.classList.contains('weave-table__cell--sticky-start'));
  assert.equal(firstHead.style.left, '0px', 'first sticky column pinned at 0');
  const firstCell: HTMLElement = bodyRows(m)[0].querySelector('.weave-table__cell') as HTMLElement;
  assert.ok(firstCell.classList.contains('weave-table__cell--sticky-start'));
  m.dispose();
});

/* ── data sources ── */
test('table: ArrayDataSource + reactive signal source both drive the body', async () => {
  const ds: ArrayDataSource<Row> = new ArrayDataSource<Row>(ROWS);
  const m1: Mounted = await mount<Row>({ columns: COLS, dataSource: ds });
  assert.equal(bodyRows(m1).length, 3);
  m1.dispose();

  const src: Signal<Row[]> = signal<Row[]>([ROWS[0]]);
  const m2: Mounted = await mount<Row>({ columns: COLS, dataSource: src });
  assert.equal(bodyRows(m2).length, 1);
  src.set(ROWS); // reactive update
  assert.equal(bodyRows(m2).length, 3, 'body tracked the signal');
  m2.dispose();
});

/* ── numeric ── */
test('table: numeric column marks cells tabular + right-aligned', async () => {
  const m: Mounted = await mount<Row>({ columns: COLS, dataSource: ROWS });
  const ageCell: HTMLElement = bodyRows(m)[0].querySelectorAll('.weave-table__cell')[1] as HTMLElement;
  assert.ok(ageCell.classList.contains('weave-table__cell--numeric'));
  assert.equal(ageCell.style.textAlign, 'end');
  m.dispose();
});
