/**
 * `<Table>` — the flagship data surface. A real `<table>` (native `<thead>/<tbody>/
 * <th scope=col>/<td>` semantics) driven by a **column-def + DataSource** API, authored as a
 * Weave template so it **composes the real child components** (RULE #1) — the selection
 * checkboxes ARE the `<Checkbox>` component (full behaviour, one checkbox in the library, not
 * a restyled native input). Rows are a keyed `@for` over the (sorted) data; arbitrary
 * `Node` cells mount via `@render`. Styled by the Weave design (hairline rows, compact 34px,
 * accent as a mark).
 *
 * Features: sortable headers (`aria-sort`, single active, emit `onSort` + convenience client
 * sort for array sources), row selection (composed `<Checkbox>` column, select-all +
 * indeterminate, accentSoft tint + 2px accent left border) via the CDK `SelectionModel`,
 * expandable detail rows, sticky header + sticky columns (`sticky:'start'|'end'`, offsets from
 * column widths), per-column show/hide (`hidden`), and an optional `maxHeight` (the body
 * scrolls vertically inside while the header stays). Virtual body is the noted follow-on.
 *
 *   import Table from '@weave-framework/ui/table';
 *   import Checkbox from '@weave-framework/ui/checkbox';   // optional — the build auto-resolves the composed <Checkbox>
 *   <Table columns={{ cols }} dataSource={{ rows }} selectable expandable />
 */
import { signal, onMount, type Signal, type Computed } from '@weave-framework/runtime';
import { selectionModel, isDataSource, draggable, activeDirection, type SelectionModel, type DataSource } from '../cdk/index.js';

export type SortDirection = 'asc' | 'desc';

export interface TableColumn<T> {
  /** Stable column id + default cell accessor (`row[key]`). */
  key: string;
  /** Header content — text or a node factory. Defaults to `key`. */
  header?: string | (() => Node);
  /** Cell content for a row — text or a node. Defaults to `String(row[key])`. */
  cell?: (row: T) => Node | string;
  /** Make the header a sort button. */
  sortable?: boolean;
  /** Custom comparator for the client-side sort (else value-based, number/string aware). */
  compare?: (a: T, b: T) => number;
  /** Cell text alignment. Numeric columns default to `end`. */
  align?: 'start' | 'center' | 'end';
  /** Right-align + `tabular-nums`. */
  numeric?: boolean;
  /** Freeze the column to an edge while scrolling horizontally (needs a numeric `width`). */
  sticky?: 'start' | 'end';
  /** Hide the column (reactive when `columns` is bound to a signal). */
  hidden?: boolean;
  /** Column width (number → px). Required for a `sticky` column's offset maths. */
  width?: number | string;
  /** Allow dragging this column's header grip to resize it (or set `resizableColumns`). */
  resizable?: boolean;
  /** Minimum width (px) when resizing. Default 48. */
  minWidth?: number;
}

export interface ColumnResize {
  key: string;
  width: number;
}

export interface SortState {
  active: string | null;
  direction: SortDirection | null;
}

export interface TableProps<T = Record<string, unknown>> {
  columns: TableColumn<T>[];
  dataSource: DataSource<T> | T[] | Signal<T[]>;
  /** Stable row identity (default: index) — row keys + selection/expansion identity. */
  trackBy?: (row: T) => string | number;

  sort?: SortState;
  onSort?: (sort: SortState) => void;
  disableClear?: boolean;
  /** Disable the convenience client-side sort for array/signal sources. */
  clientSort?: boolean;

  selectable?: boolean;
  selectionMode?: 'single' | 'multiple';
  selection?: SelectionModel<T>;
  onSelectionChange?: (selected: T[]) => void;
  compareWith?: (a: T, b: T) => boolean;

  expandable?: boolean;
  detail?: (row: T) => Node | string;

  /** Cap the body height (number → px) — the body scrolls vertically, header stays. */
  maxHeight?: number | string;

  /** Make every column resizable (per-column `resizable` overrides this). */
  resizableColumns?: boolean;
  /** Controlled column widths (px), keyed by column key — wins over internal + `column.width`. */
  columnWidths?: Record<string, number>;
  /** Called after a resize with the column key + its new width (px). */
  onColumnResize?: (event: ColumnResize) => void;

  ariaLabel?: string;
  emptyText?: string;
  class?: string;
}

// Fixed widths of the synthetic leading columns (used for sticky-offset maths + cell width).
const EXPAND_W: number = 40;
const SELECT_W: number = 44;
const DEFAULT_STICKY_W: number = 120;
const DEFAULT_MIN_W: number = 48;
const RESIZE_STEP: number = 16; // keyboard resize increment (px)

/** A layout slot (synthetic or data column) for sticky-offset computation. */
interface Slot {
  id: string;
  width: number;
  sticky?: 'start' | 'end';
}

/** A pre-resolved cell for a row — built per row so the inner `@for` references only itself
 *  (the compiler names every `@for` item `_row`, so a nested loop can't reach the outer row). */
interface CellView {
  key: string;
  cls: string;
  style: string;
  node: Node;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }}>' +
  '<div class="weave-table__scroll" style={{ scrollStyle() }}>' +
  '<table class="weave-table__grid" aria-label={{ ariaLabel() }}>' +
  '<thead class="weave-table__header"><tr class="weave-table__header-row">' +
  '@if (expandable()) {<th class="weave-table__header-cell weave-table__expand weave-table__cell--sticky-start" style={{ expandStyle() }}></th>}' +
  '@if (selectable()) {<th class="weave-table__header-cell weave-table__select weave-table__cell--sticky-start" style={{ selectStyle() }}>' +
  '@if (showSelectAll()) {<Checkbox checked={{ allChecked() }} indeterminate={{ someChecked() }} onChange={{ onSelectAll }} label="Select all rows" />}' +
  '</th>}' +
  '@for (col of dataCols(); track col.key) {' +
  '<th class={{ headClass(col) }} scope="col" style={{ headStyle(col) }} aria-sort={{ ariaSort(col) }}>' +
  '@if (col.sortable) {<button type="button" class={{ sortClass(col) }} on:click={{ () => cycleSort(col.key) }}>' +
  '@render (headNode(col))<span class="weave-table__sort-arrow" aria-hidden="true">' +
  '@if (arrow(col)) {<Icon name={{ arrow(col) }} />}</span></button>}' +
  '@if (!col.sortable) {@render (headNode(col))}' +
  '@if (isResizable(col)) {<span class="weave-table__resize-grip" role="separator" aria-orientation="vertical"' +
  ' tabindex="0" aria-label={{ resizeLabel(col) }} data-col={{ col.key }}' +
  ' aria-valuenow={{ gripValueNow(col) }} aria-valuemin={{ gripValueMin(col) }}' +
  ' on:keydown={{ (e) => onGripKeydown(col.key, e) }}></span>}' +
  '</th>}' +
  '</tr></thead>' +
  '<tbody class="weave-table__body">' +
  '@for (row of rows(); track rowKey(row)) {' +
  '<tr class={{ rowClass(row) }} aria-selected={{ ariaSelected(row) }}>' +
  '@if (expandable()) {<td class="weave-table__cell weave-table__expand weave-table__cell--sticky-start" style={{ expandStyle() }}>' +
  '<button type="button" class="weave-table__expand-toggle" aria-label="Toggle row details"' +
  ' aria-expanded={{ ariaExpanded(row) }} on:click={{ () => toggleExpand(row) }}>' +
  '<Icon name={{ \'chevron-right\' }} /></button></td>}' +
  '@if (selectable()) {<td class="weave-table__cell weave-table__select weave-table__cell--sticky-start" style={{ selectStyle() }}>' +
  '<Checkbox checked={{ isSelected(row) }} onChange={{ (checked) => toggleSelect(row, checked) }} label="Select row" /></td>}' +
  '@for (cell of cellsFor(row); track cell.key) {' +
  '<td class={{ cell.cls }} style={{ cell.style }}>@render (cell.node)</td>}' +
  '</tr>' +
  '@if (rowExpanded(row)) {<tr class="weave-table__detail"><td class="weave-table__detail-cell" colspan={{ colSpan() }}>@render (detailNode(row))</td></tr>}' +
  '}' +
  '@if (isEmpty()) {<tr><td class="weave-table__empty" colspan={{ colSpan() }}>{{ emptyText() }}</td></tr>}' +
  '</tbody></table></div></div>';

export interface TableContext<T> {
  host: Signal<HTMLElement | null>;
  rootClass: () => string;
  scrollStyle: () => string;
  ariaLabel: () => string | undefined;
  selectable: () => boolean;
  expandable: () => boolean;
  showSelectAll: () => boolean;
  dataCols: () => TableColumn<T>[];
  colSpan: () => number;
  isEmpty: () => boolean;
  emptyText: () => string;
  rows: () => T[];
  rowKey: (row: T) => unknown;
  rowClass: (row: T) => string;
  ariaSelected: (row: T) => 'true' | 'false';
  isSelected: (row: T) => boolean;
  toggleSelect: (row: T, checked: boolean) => void;
  allChecked: () => boolean;
  someChecked: () => boolean;
  onSelectAll: (checked: boolean) => void;
  isExpanded: (row: T) => boolean;
  ariaExpanded: (row: T) => 'true' | 'false';
  rowExpanded: (row: T) => boolean;
  toggleExpand: (row: T) => void;
  headNode: (col: TableColumn<T>) => Node;
  headClass: (col: TableColumn<T>) => string;
  headStyle: (col: TableColumn<T>) => string;
  sortClass: (col: TableColumn<T>) => string;
  ariaSort: (col: TableColumn<T>) => 'ascending' | 'descending' | 'none';
  arrow: (col: TableColumn<T>) => string;
  cycleSort: (key: string) => void;
  isResizable: (col: TableColumn<T>) => boolean;
  resizeLabel: (col: TableColumn<T>) => string;
  gripValueNow: (col: TableColumn<T>) => string | undefined;
  gripValueMin: (col: TableColumn<T>) => string;
  onGripKeydown: (key: string, event: KeyboardEvent) => void;
  cellsFor: (row: T) => CellView[];
  detailNode: (row: T) => Node;
  expandStyle: () => string;
  selectStyle: () => string;
}

export function setup<T = Record<string, unknown>>(props: TableProps<T>): TableContext<T> {
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);

  /* ── data source + client sort ── */
  const rowsView: Computed<T[]> = isDataSource<T>(props.dataSource)
    ? props.dataSource.connect()
    : typeof props.dataSource === 'function'
      ? (props.dataSource as Signal<T[]>)
      : ((): T[] => props.dataSource as T[]);
  const isCustomSource: boolean = isDataSource<T>(props.dataSource);

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

  /* ── selection + expansion (CDK SelectionModel) ── */
  const selectable = (): boolean => !!props.selectable;
  const expandable = (): boolean => !!props.expandable;
  const multiple = (): boolean => props.selectionMode !== 'single';
  const selection: SelectionModel<T> =
    props.selection ??
    selectionModel<T>({
      multiple: props.selectionMode !== 'single',
      compareWith: props.compareWith,
      onChange: () => props.onSelectionChange?.(selection.selected()),
    });
  const expanded: SelectionModel<T> = selectionModel<T>({ multiple: true, compareWith: props.compareWith });

  /* ── columns + sticky offsets (from widths — no DOM measurement) ── */
  const dataCols = (): TableColumn<T>[] => props.columns.filter((c) => !c.hidden);

  /* ── column resize: an internal width override (px), keyed by column ── */
  const _widths: Signal<Record<string, number>> = signal<Record<string, number>>({});
  const isResizable = (c: TableColumn<T>): boolean => c.resizable ?? !!props.resizableColumns;
  const minW = (c: TableColumn<T>): number => c.minWidth ?? DEFAULT_MIN_W;
  // Effective px width: controlled prop wins, then an internal resize override, then a numeric `width`.
  const effWidth = (c: TableColumn<T>): number | undefined =>
    props.columnWidths?.[c.key] ?? _widths()[c.key] ?? (typeof c.width === 'number' ? c.width : undefined);
  const setWidth = (c: TableColumn<T>, width: number): void => {
    const w: number = Math.max(minW(c), Math.round(width));
    if (props.columnWidths === undefined) _widths.set({ ..._widths(), [c.key]: w });
    props.onColumnResize?.({ key: c.key, width: w });
  };

  const colW = (c: TableColumn<T>): number => effWidth(c) ?? DEFAULT_STICKY_W;
  const slots = (): Slot[] => {
    const out: Slot[] = [];
    if (expandable()) out.push({ id: '__expand', width: EXPAND_W, sticky: 'start' });
    if (selectable()) out.push({ id: '__select', width: SELECT_W, sticky: 'start' });
    for (const c of dataCols()) out.push({ id: c.key, width: colW(c), sticky: c.sticky });
    return out;
  };
  const stickyStyleFor = (id: string): string => {
    const s: Slot[] = slots();
    const idx: number = s.findIndex((x) => x.id === id);
    if (idx < 0 || !s[idx].sticky) return '';
    // Logical insets so sticky columns dock to the correct edge under RTL.
    if (s[idx].sticky === 'start') {
      let px: number = 0;
      for (let i: number = 0; i < idx; i++) if (s[i].sticky === 'start') px += s[i].width;
      return `inset-inline-start:${px}px`;
    }
    let px: number = 0;
    for (let i: number = s.length - 1; i > idx; i--) if (s[i].sticky === 'end') px += s[i].width;
    return `inset-inline-end:${px}px`;
  };

  const alignOf = (c: TableColumn<T>): string => c.align ?? (c.numeric ? 'end' : 'start');
  const widthCss = (c: TableColumn<T>): string => {
    const eff: number | undefined = effWidth(c);
    if (eff != null) return `width:${eff}px`;
    return c.width == null ? '' : `width:${c.width}`; // a string width passes through
  };
  const joinStyle = (...parts: string[]): string => parts.filter(Boolean).join(';');

  /* ── resize interaction: pointer drag (CDK draggable) + keyboard on the grip ── */
  const resizeCol = (key: string): TableColumn<T> | undefined => props.columns.find((c) => c.key === key);
  let dragStartWidth: number = 0;
  const onGripKeydown = (key: string, event: KeyboardEvent): void => {
    const col: TableColumn<T> | undefined = resizeCol(key);
    if (!col) return;
    const cur: number = effWidth(col) ?? DEFAULT_STICKY_W;
    // In RTL the grip sits on the left edge, so ArrowRight narrows and ArrowLeft widens.
    const grow: number = activeDirection() === 'rtl' ? -RESIZE_STEP : RESIZE_STEP;
    if (event.key === 'ArrowLeft') {
      setWidth(col, cur - grow);
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      setWidth(col, cur + grow);
      event.preventDefault();
    }
  };

  // Attach a pointer-drag to each header grip once the table is in the DOM.
  onMount(() => {
    const el: HTMLElement | null = host();
    if (!el) return;
    el.querySelectorAll<HTMLElement>('.weave-table__resize-grip').forEach((grip) => {
      const key: string = grip.getAttribute('data-col') ?? '';
      const col: TableColumn<T> | undefined = resizeCol(key);
      if (!col) return;
      draggable(grip, {
        axis: 'x',
        onStart: () => {
          dragStartWidth = effWidth(col) ?? (grip.closest('th') as HTMLElement | null)?.offsetWidth ?? DEFAULT_STICKY_W;
          el.setAttribute('data-resizing', 'true');
        },
        onMove: ({ dx }) => setWidth(col, dragStartWidth + dx),
        onEnd: () => el.removeAttribute('data-resizing'),
      });
    });
  });

  // Key rows by a stable id (trackBy) or by object identity — NOT by index, so a sort
  // reorders the existing DOM by identity (content stays with its row) instead of rebinding
  // positions (which, with one-shot `@render` cells, would strand stale content).
  const rowKey = (row: T): unknown => (props.trackBy ? String(props.trackBy(row)) : row);

  const asNode = (content: Node | string): Node => (typeof content === 'string' ? document.createTextNode(content) : content);

  const cellClassOf = (col: TableColumn<T>): string => {
    const parts: string[] = ['weave-table__cell'];
    if (col.numeric) parts.push('weave-table__cell--numeric');
    if (col.sticky) parts.push(`weave-table__cell--sticky-${col.sticky}`);
    return parts.join(' ');
  };
  const cellStyleOf = (col: TableColumn<T>): string => joinStyle(widthCss(col), `text-align:${alignOf(col)}`, stickyStyleFor(col.key));
  const cellNodeOf = (row: T, col: TableColumn<T>): Node =>
    asNode(col.cell ? col.cell(row) : String((row as Record<string, unknown>)[col.key] ?? ''));

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-table'];
      if (selectable()) parts.push('weave-table--selectable');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    scrollStyle: (): string =>
      props.maxHeight == null ? '' : `max-height:${typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight}`,
    ariaLabel: (): string | undefined => props.ariaLabel,
    selectable,
    expandable,
    showSelectAll: (): boolean => multiple(),
    dataCols,
    colSpan: (): number => dataCols().length + (selectable() ? 1 : 0) + (expandable() ? 1 : 0),
    isEmpty: (): boolean => rows().length === 0,
    emptyText: (): string => props.emptyText ?? 'No data',
    rows,
    rowKey,
    rowClass: (row: T): string => (expanded.isSelected(row) ? 'weave-table__row weave-table__row--expanded' : 'weave-table__row'),
    ariaSelected: (row: T): 'true' | 'false' => (selection.isSelected(row) ? 'true' : 'false'),
    isSelected: (row: T): boolean => selection.isSelected(row),
    // The composed <Checkbox>'s onChange delivers the next checked state as a boolean (only
    // real `on:X` events are auto-forwarded, so a data-callback prop fires exactly once).
    toggleSelect: (row: T, checked: boolean): void => {
      if (checked) selection.select(row);
      else selection.deselect(row);
    },
    allChecked: (): boolean => {
      const data: T[] = rows();
      return data.length > 0 && data.every((r) => selection.isSelected(r));
    },
    someChecked: (): boolean => {
      const data: T[] = rows();
      const n: number = data.filter((r) => selection.isSelected(r)).length;
      return n > 0 && n < data.length;
    },
    onSelectAll: (checked: boolean): void => {
      if (checked) selection.setSelection(...rows());
      else selection.clear();
    },
    isExpanded: (row: T): boolean => expanded.isSelected(row),
    ariaExpanded: (row: T): 'true' | 'false' => (expanded.isSelected(row) ? 'true' : 'false'),
    rowExpanded: (row: T): boolean => expandable() && expanded.isSelected(row),
    toggleExpand: (row: T): void => expanded.toggle(row),
    headNode: (col: TableColumn<T>): Node =>
      typeof col.header === 'function' ? col.header() : document.createTextNode(col.header ?? col.key),
    headClass: (col: TableColumn<T>): string =>
      col.sticky ? `weave-table__header-cell weave-table__cell--sticky-${col.sticky}` : 'weave-table__header-cell',
    headStyle: (col: TableColumn<T>): string => joinStyle(widthCss(col), `text-align:${alignOf(col)}`, stickyStyleFor(col.key)),
    sortClass: (col: TableColumn<T>): string =>
      sortState().active === col.key ? 'weave-table__sort weave-table__sort--active' : 'weave-table__sort',
    ariaSort: (col: TableColumn<T>): 'ascending' | 'descending' | 'none' => {
      const s: SortState = sortState();
      if (s.active !== col.key || !s.direction) return 'none';
      return s.direction === 'asc' ? 'ascending' : 'descending';
    },
    // The sort indicator is a lucide icon NAME (not a ↑/↓ character) — '' when this column is
    // not the active sort, which the template uses as the render condition.
    arrow: (col: TableColumn<T>): string => {
      const s: SortState = sortState();
      if (s.active !== col.key || !s.direction) return '';
      return s.direction === 'desc' ? 'arrow-down' : 'arrow-up';
    },
    cycleSort,
    isResizable,
    resizeLabel: (col: TableColumn<T>): string =>
      `Resize ${typeof col.header === 'string' ? col.header : col.key} column`,
    // APG window-splitter: the separator exposes its current width (once known — reactive on resize)
    // and the min it can shrink to. No hard max, so aria-valuemax is intentionally omitted.
    gripValueNow: (col: TableColumn<T>): string | undefined => {
      const w: number | undefined = effWidth(col);
      return w != null ? String(Math.round(w)) : undefined;
    },
    gripValueMin: (col: TableColumn<T>): string => String(minW(col)),
    onGripKeydown,
    cellsFor: (row: T): CellView[] =>
      dataCols().map((col) => ({ key: col.key, cls: cellClassOf(col), style: cellStyleOf(col), node: cellNodeOf(row, col) })),
    detailNode: (row: T): Node => asNode(props.detail ? props.detail(row) : ''),
    expandStyle: (): string => joinStyle('width:' + EXPAND_W + 'px', stickyStyleFor('__expand')),
    selectStyle: (): string => joinStyle('width:' + SELECT_W + 'px', stickyStyleFor('__select')),
  };
}
