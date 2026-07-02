/**
 * `<Table>` — the flagship data surface. A real `<table>` (native `<thead>/<tbody>/<tr>/
 * <th scope=col>/<td>` semantics) driven by a **column-def + DataSource** API, built
 * imperatively in `setup()` (cells are arbitrary `Node`s and the body is reactive over the
 * data/sort/selection/expansion — text interpolation can't carry either, so the grid is
 * constructed in JS and kept live with effects). Zero-dep; composes the CDK `SelectionModel`
 * (row select + row expand) + U2 `Checkbox` semantics; the visual is the Weave design
 * (hairline rows, compact 34px, accent as a mark).
 *
 * Features: sortable headers (aria-sort, single active column, emit `onSort` + convenience
 * client-side sort for array sources), row selection (leading checkbox column, select-all,
 * accentSoft tint + 2px accent left border), expandable detail rows, sticky header + sticky
 * columns (`sticky: 'start'|'end'`), and per-column show/hide (`hidden`). Virtual body is the
 * noted follow-on (the CDK `virtualScroll` hook is ready); v1 is plain-scroll.
 *
 *   import Table from '@weave-framework/ui/table';
 *   <Table columns={{ cols }} dataSource={{ rows }} selectable sort={{ sort() }} onSort={{ setSort }} />
 */
import { signal, effect, onMount, onDispose, type Signal, type Computed } from '@weave-framework/runtime';
import { selectionModel, isDataSource, type SelectionModel, type DataSource } from '../cdk/index.js';

/** A comparable cell value for the built-in client sort. */
export type SortDirection = 'asc' | 'desc';

export interface TableColumn<T> {
  /** Stable column id + default cell accessor (`row[key]`). */
  key: string;
  /** Header content — text or a node factory. Defaults to `key`. */
  header?: string | (() => Node);
  /** Cell content for a row — text or a node. Defaults to `String(row[key])`. */
  cell?: (row: T) => Node | string;
  /** Footer content across all rows (renders a sticky `<tfoot>` when any column has one). */
  footer?: (rows: T[]) => Node | string;
  /** Make the header a sort button. */
  sortable?: boolean;
  /** Custom comparator for the client-side sort (else value-based, number/string aware). */
  compare?: (a: T, b: T) => number;
  /** Cell text alignment. Numeric columns default to `end`. */
  align?: 'start' | 'center' | 'end';
  /** Right-align + `tabular-nums`. */
  numeric?: boolean;
  /** Freeze the column to an edge while scrolling horizontally. */
  sticky?: 'start' | 'end';
  /** Hide the column (reactive when `columns` is bound to a signal). */
  hidden?: boolean;
  /** Fixed column width (number → px). */
  width?: number | string;
}

export interface SortState {
  active: string | null;
  direction: SortDirection | null;
}

export interface TableProps<T = Record<string, unknown>> {
  /** Column definitions (bind a signal for reactive show/hide or column changes). */
  columns: TableColumn<T>[];
  /** The rows — a DataSource, a plain array, or a signal of rows. */
  dataSource: DataSource<T> | T[] | Signal<T[]>;
  /** Stable row identity (default: index) — used for selection/expansion + row keys. */
  trackBy?: (row: T) => string | number;

  /** Controlled sort; also emitted on every header click. */
  sort?: SortState;
  onSort?: (sort: SortState) => void;
  /** Header cycle is asc↔desc only (no clear-to-none). */
  disableClear?: boolean;
  /** Disable the convenience client-side sort for array/signal sources. */
  clientSort?: boolean;

  /** Show a leading selection checkbox column. */
  selectable?: boolean;
  /** 'multiple' (default) or 'single'. */
  selectionMode?: 'single' | 'multiple';
  /** Bring your own selection model (else one is created). */
  selection?: SelectionModel<T>;
  /** Called with the selected rows on any selection change. */
  onSelectionChange?: (selected: T[]) => void;
  /** Row identity for selection/expansion (default `===`). */
  compareWith?: (a: T, b: T) => boolean;

  /** Enable a leading expand-toggle column with a per-row detail panel. */
  expandable?: boolean;
  /** The detail content for an expanded row. */
  detail?: (row: T) => Node | string;

  /** Cap the body height (number → px) — the `<tbody>` scrolls vertically inside while the
   *  sticky header stays put. Omit for a table that grows to its content. */
  maxHeight?: number | string;
  /** Accessible name for the table. */
  ariaLabel?: string;
  /** Shown when there are no rows. Default 'No data'. */
  emptyText?: string;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string = '<div class={{ rootClass() }} ref={{ host }}></div>';

export interface TableContext {
  host: Signal<HTMLElement | null>;
  rootClass: () => string;
}

/** Internal column descriptor (data columns + synthetic select/expand columns). */
interface Col<T> {
  kind: 'select' | 'expand' | 'data';
  def?: TableColumn<T>;
  sticky?: 'start' | 'end';
}

let _seq: number = 0;

export function setup<T = Record<string, unknown>>(props: TableProps<T>): TableContext {
  const uid: number = ++_seq;
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const ready: Signal<boolean> = signal<boolean>(false);
  const built: Signal<number> = signal<number>(0); // bumped after a body rebuild

  /* ── data source ── */
  const rowsView: Computed<T[]> = isDataSource<T>(props.dataSource)
    ? props.dataSource.connect()
    : typeof props.dataSource === 'function'
      ? (props.dataSource as Signal<T[]>)
      : ((): T[] => props.dataSource as T[]);
  const isCustomSource: boolean = isDataSource<T>(props.dataSource);

  /* ── sort ── */
  const _sort: Signal<SortState> = signal<SortState>(props.sort ?? { active: null, direction: null });
  const sortControlled = (): boolean => props.sort !== undefined;
  const sortState = (): SortState => (sortControlled() ? (props.sort as SortState) : _sort());

  const cmpValues = (a: unknown, b: unknown): number => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  };

  const rows = (): T[] => {
    const base: T[] = rowsView();
    const s: SortState = sortState();
    // Convenience client sort for array/signal sources (a custom DataSource owns its order).
    if (isCustomSource || props.clientSort === false || !s.active || !s.direction) return base;
    const col: TableColumn<T> | undefined = props.columns.find((c) => c.key === s.active);
    if (!col) return base;
    const dir: number = s.direction === 'asc' ? 1 : -1;
    const cmp: (a: T, b: T) => number =
      col.compare ?? ((a, b) => cmpValues((a as Record<string, unknown>)[col.key], (b as Record<string, unknown>)[col.key]));
    return [...base].sort((a, b) => cmp(a, b) * dir);
  };

  const cycleSort = (key: string): void => {
    const s: SortState = sortState();
    let next: SortState;
    if (s.active !== key) next = { active: key, direction: 'asc' };
    else if (s.direction === 'asc') next = { active: key, direction: 'desc' };
    else if (s.direction === 'desc')
      next = props.disableClear ? { active: key, direction: 'asc' } : { active: null, direction: null };
    else next = { active: key, direction: 'asc' };
    if (!sortControlled()) _sort.set(next);
    props.onSort?.(next);
  };

  /* ── selection + expansion (both are CDK SelectionModels) ── */
  const compareWith: ((a: T, b: T) => boolean) | undefined = props.compareWith;
  const selection: SelectionModel<T> =
    props.selection ??
    selectionModel<T>({
      multiple: props.selectionMode !== 'single',
      compareWith,
      onChange: () => props.onSelectionChange?.(selection.selected()),
    });
  const expanded: SelectionModel<T> = selectionModel<T>({ multiple: true, compareWith });

  /* ── columns (data + synthetic) ── */
  const visibleDataCols = (): TableColumn<T>[] => props.columns.filter((c) => !c.hidden);
  const cols = (): Col<T>[] => {
    const out: Col<T>[] = [];
    if (props.expandable) out.push({ kind: 'expand', sticky: 'start' });
    if (props.selectable) out.push({ kind: 'select', sticky: 'start' });
    for (const def of visibleDataCols()) out.push({ kind: 'data', def, sticky: def.sticky });
    return out;
  };
  const colCount = (): number => cols().length;

  const rowKey = (row: T, i: number): string => (props.trackBy ? String(props.trackBy(row)) : String(i));

  const alignOf = (def: TableColumn<T>): string => def.align ?? (def.numeric ? 'end' : 'start');

  /* ── DOM refs (built on mount) ── */
  let scrollEl: HTMLElement | null = null;
  let tableEl: HTMLTableElement | null = null;
  let theadEl: HTMLTableSectionElement | null = null;
  let tbodyEl: HTMLTableSectionElement | null = null;
  const rowEls: Map<string, { tr: HTMLTableRowElement; check?: HTMLInputElement; expandBtn?: HTMLButtonElement; detail?: HTMLTableRowElement; row: T }> = new Map();
  let selectAllCheck: HTMLInputElement | null = null;

  const setCell = (el: HTMLElement, content: Node | string): void => {
    if (typeof content === 'string') el.textContent = content;
    else el.appendChild(content);
  };

  /* ── header ── */
  const buildHeader = (): void => {
    if (!theadEl) return;
    theadEl.textContent = '';
    const tr: HTMLTableRowElement = document.createElement('tr');
    tr.className = 'weave-table__header-row';
    const s: SortState = sortState();
    for (const c of cols()) {
      const th: HTMLTableCellElement = document.createElement('th');
      th.scope = 'col';
      th.className = 'weave-table__header-cell';
      if (c.kind === 'select') {
        th.classList.add('weave-table__select');
        if (props.selectionMode !== 'single') {
          const cb: HTMLInputElement = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'weave-table__checkbox';
          cb.setAttribute('aria-label', 'Select all rows');
          cb.addEventListener('change', () => {
            if (cb.checked) selection.setSelection(...rows());
            else selection.clear();
          });
          selectAllCheck = cb;
          th.appendChild(cb);
        }
      } else if (c.kind === 'expand') {
        th.classList.add('weave-table__expand');
      } else if (c.def) {
        const def: TableColumn<T> = c.def;
        th.style.textAlign = alignOf(def);
        if (def.width != null) th.style.width = typeof def.width === 'number' ? `${def.width}px` : def.width;
        const headerNode: Node = typeof def.header === 'function' ? def.header() : document.createTextNode(def.header ?? def.key);
        if (def.sortable) {
          const btn: HTMLButtonElement = document.createElement('button');
          btn.type = 'button';
          btn.className = 'weave-table__sort';
          const active: boolean = s.active === def.key;
          if (active) btn.classList.add('weave-table__sort--active');
          btn.appendChild(headerNode);
          const arrow: HTMLElement = document.createElement('span');
          arrow.className = 'weave-table__sort-arrow';
          arrow.setAttribute('aria-hidden', 'true');
          arrow.textContent = active ? (s.direction === 'desc' ? '↓' : '↑') : '';
          btn.appendChild(arrow);
          btn.addEventListener('click', () => cycleSort(def.key));
          th.setAttribute('aria-sort', active ? (s.direction === 'desc' ? 'descending' : 'ascending') : 'none');
          th.appendChild(btn);
        } else {
          th.appendChild(headerNode);
        }
      }
      tr.appendChild(th);
    }
    theadEl.appendChild(tr);
  };

  /* ── body ── */
  const buildBody = (): void => {
    if (!tbodyEl) return;
    tbodyEl.textContent = '';
    rowEls.clear();
    const data: T[] = rows();
    const list: Col<T>[] = cols();
    if (data.length === 0) {
      const tr: HTMLTableRowElement = document.createElement('tr');
      const td: HTMLTableCellElement = document.createElement('td');
      td.colSpan = Math.max(1, list.length);
      td.className = 'weave-table__empty';
      td.textContent = props.emptyText ?? 'No data';
      tr.appendChild(td);
      tbodyEl.appendChild(tr);
      return;
    }
    data.forEach((row, i) => {
      const key: string = rowKey(row, i);
      const tr: HTMLTableRowElement = document.createElement('tr');
      tr.className = 'weave-table__row';
      const entry: { tr: HTMLTableRowElement; check?: HTMLInputElement; expandBtn?: HTMLButtonElement; detail?: HTMLTableRowElement; row: T } = { tr, row };
      for (const c of list) {
        const td: HTMLTableCellElement = document.createElement('td');
        td.className = 'weave-table__cell';
        if (c.kind === 'select') {
          td.classList.add('weave-table__select');
          const cb: HTMLInputElement = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'weave-table__checkbox';
          cb.setAttribute('aria-label', 'Select row');
          cb.addEventListener('change', () => selection.toggle(row));
          entry.check = cb;
          td.appendChild(cb);
        } else if (c.kind === 'expand') {
          td.classList.add('weave-table__expand');
          const btn: HTMLButtonElement = document.createElement('button');
          btn.type = 'button';
          btn.className = 'weave-table__expand-toggle';
          btn.setAttribute('aria-label', 'Toggle row details');
          btn.setAttribute('aria-expanded', 'false');
          btn.setAttribute('aria-controls', `weave-table-${uid}-detail-${key}`);
          btn.addEventListener('click', () => expanded.toggle(row));
          entry.expandBtn = btn;
          td.appendChild(btn);
        } else if (c.def) {
          const def: TableColumn<T> = c.def;
          td.style.textAlign = alignOf(def);
          if (def.numeric) td.classList.add('weave-table__cell--numeric');
          const content: Node | string = def.cell
            ? def.cell(row)
            : String((row as Record<string, unknown>)[def.key] ?? '');
          setCell(td, content);
        }
        tr.appendChild(td);
      }
      tbodyEl!.appendChild(tr);

      if (props.expandable) {
        const dtr: HTMLTableRowElement = document.createElement('tr');
        dtr.className = 'weave-table__detail';
        dtr.id = `weave-table-${uid}-detail-${key}`;
        dtr.hidden = true;
        const dtd: HTMLTableCellElement = document.createElement('td');
        dtd.colSpan = Math.max(1, list.length);
        dtd.className = 'weave-table__detail-cell';
        if (props.detail) setCell(dtd, props.detail(row));
        dtr.appendChild(dtd);
        tbodyEl!.appendChild(dtr);
        entry.detail = dtr;
      }
      rowEls.set(key, entry);
    });
    applySticky(list);
  };

  /* ── sticky column offsets (measured after layout) ── */
  const applySticky = (list: Col<T>[]): void => {
    if (!theadEl) return;
    const headCells: HTMLElement[] = Array.from(theadEl.querySelectorAll<HTMLElement>('.weave-table__header-cell'));
    const bodyRows: HTMLTableRowElement[] = Array.from(tbodyEl?.querySelectorAll<HTMLTableRowElement>('tr.weave-table__row') ?? []);
    const applyOne = (i: number, side: 'left' | 'right', px: number): void => {
      const cls: string = side === 'left' ? 'weave-table__cell--sticky-start' : 'weave-table__cell--sticky-end';
      const set = (el: HTMLElement | undefined): void => {
        if (!el) return;
        el.style[side] = `${px}px`;
        el.classList.add(cls);
      };
      set(headCells[i]);
      for (const r of bodyRows) set(r.children[i] as HTMLElement | undefined);
    };
    let left: number = 0;
    for (let i: number = 0; i < list.length; i++) {
      if (list[i].sticky === 'start') {
        applyOne(i, 'left', left);
        left += headCells[i]?.offsetWidth ?? 0;
      }
    }
    let right: number = 0;
    for (let i: number = list.length - 1; i >= 0; i--) {
      if (list[i].sticky === 'end') {
        applyOne(i, 'right', right);
        right += headCells[i]?.offsetWidth ?? 0;
      }
    }
  };

  /* ── reactive wiring ── */
  // Structural rebuild — header + body when data / sort / columns change.
  effect(() => {
    if (!ready()) return;
    rows();
    sortState();
    cols();
    buildHeader();
    buildBody();
    built.set(built.peek() + 1);
  });

  // Selection tint + checkboxes — reapplied after each rebuild + on selection change.
  effect(() => {
    built();
    selection.selected();
    if (!ready()) return;
    let selCount: number = 0;
    for (const entry of rowEls.values()) {
      const on: boolean = selection.isSelected(entry.row);
      if (on) selCount++;
      entry.tr.setAttribute('aria-selected', on ? 'true' : 'false');
      if (entry.check) entry.check.checked = on;
    }
    if (selectAllCheck) {
      const total: number = rowEls.size;
      selectAllCheck.checked = total > 0 && selCount === total;
      selectAllCheck.indeterminate = selCount > 0 && selCount < total;
    }
  });

  // Expansion — detail-row visibility + chevron state; reapplied after each rebuild.
  effect(() => {
    built();
    expanded.selected();
    if (!ready()) return;
    for (const entry of rowEls.values()) {
      const on: boolean = expanded.isSelected(entry.row);
      if (entry.detail) entry.detail.hidden = !on;
      if (entry.expandBtn) entry.expandBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      entry.tr.classList.toggle('weave-table__row--expanded', on);
    }
  });

  onMount(() => {
    const el: HTMLElement | null = host();
    if (!el) return;
    scrollEl = document.createElement('div');
    scrollEl.className = 'weave-table__scroll';
    if (props.maxHeight != null) {
      scrollEl.style.maxHeight = typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight;
    }
    tableEl = document.createElement('table');
    tableEl.className = 'weave-table__grid';
    if (props.ariaLabel) tableEl.setAttribute('aria-label', props.ariaLabel);
    theadEl = document.createElement('thead');
    theadEl.className = 'weave-table__header';
    tbodyEl = document.createElement('tbody');
    tbodyEl.className = 'weave-table__body';
    tableEl.append(theadEl, tbodyEl);
    scrollEl.appendChild(tableEl);
    el.appendChild(scrollEl);
    ready.set(true);
  });

  onDispose(() => rowEls.clear());

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-table'];
      if (props.selectable) parts.push('weave-table--selectable');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
  };
}
