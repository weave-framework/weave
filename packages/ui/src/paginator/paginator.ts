/**
 * `<Paginator>` — page navigation over a total item count.
 *
 * Prev / next arrows around a **windowed** run of page buttons: the first and last
 * page are always shown, a window of `siblingCount` pages surrounds the current one,
 * and the gaps collapse to an ellipsis (…) — so 100 pages read as `‹ 1 … 5 6 7 … 100 ›`.
 * The active page takes the ink fill. A **"N–M of T" range label**, a **manual
 * "go to page" input**, and an optional **page-size menu** round it out.
 *
 * Pure + controlled: pass `length` (total items), `pageSize`, and `pageIndex` (0-based);
 * every action calls `onPage({ pageIndex, pageSize, length })` — the paginator computes
 * the page count, the window and the range label, and never fetches data itself.
 *
 *   import Paginator from '@weave-framework/ui/paginator';
 *   <Paginator length={{ 973 }} pageSize={{ 12 }} pageIndex={{ page() }}
 *              pageSizeOptions={{ [12, 24, 48] }} onPage={{ (e) => setPage(e.pageIndex) }} />
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { menu, type MenuOptions, type MenuItem } from '../menu/menu.js';

export interface PageEvent {
  pageIndex: number;
  pageSize: number;
  length: number;
}

export interface PaginatorProps {
  /** Total number of items. */
  length: number;
  /** Items per page. */
  pageSize: number;
  /** Current page, 0-based. */
  pageIndex: number;
  /** Called with the next state on any navigation / size change. */
  onPage?: (event: PageEvent) => void;
  /** If set, shows a page-size menu with these options. */
  pageSizeOptions?: number[];
  /** Pages shown on each side of the current one before an ellipsis. Default 1. */
  siblingCount?: number;
  /** Pages pinned at each end. Default 1. */
  boundaryCount?: number;
  /** Show the "N–M of T" range label. Default true. */
  showRange?: boolean;
  /** Show the manual "go to page" input. Default true. */
  showJump?: boolean;
  /** Disable the whole paginator. */
  disabled?: boolean;
  /** Accessible name for the nav landmark. Default "Pagination". */
  label?: string;
  /** Label before the jump input. Default "Go to". */
  jumpLabel?: string;
  /** Extra classes, forwarded onto the nav. */
  class?: string;
}

type PageCell = number | 'ellipsis';

export const template: string =
  '<nav class={{ rootClass() }} ref={{ host }} aria-label={{ navLabel() }}>' +
  '<button class="weave-paginator__nav" type="button" aria-label="Previous page"' +
  ' disabled={{ prevDisabled() }} on:click={{ prev }}>‹</button>' +
  '@for (cell of cells(); track $index) {' +
  '@if (isPage(cell)) {' +
  '<button class="weave-paginator__page" type="button" aria-label={{ pageLabel(cell) }}' +
  ' aria-current={{ pageCurrent(cell) }} disabled={{ isDisabled() }}' +
  ' on:click={{ () => goTo(cell) }}>{{ cell }}</button>' +
  '}' +
  '@if (!isPage(cell)) {<span class="weave-paginator__ellipsis" aria-hidden="true">…</span>}' +
  '}' +
  '<button class="weave-paginator__nav" type="button" aria-label="Next page"' +
  ' disabled={{ nextDisabled() }} on:click={{ next }}>›</button>' +
  '@if (showRange()) {<span class="weave-paginator__range">{{ rangeText() }}</span>}' +
  '@if (showJump()) {' +
  '<span class="weave-paginator__jump">' +
  '<label class="weave-paginator__jump-label">{{ jumpLabel() }}</label>' +
  '<input class="weave-paginator__jump-input" type="number" min="1" max={{ pageCount() }}' +
  ' .value={{ currentPage() }} disabled={{ isDisabled() }} aria-label="Go to page"' +
  ' on:keydown={{ onJumpKeydown }}>' +
  '</span>' +
  '}' +
  '@if (hasSizeOptions()) {' +
  '<button class="weave-paginator__size" type="button" aria-label="Items per page"' +
  ' disabled={{ isDisabled() }} use:menu={{ sizeMenuConfig }}>{{ sizeText() }}</button>' +
  '}' +
  '</nav>';

export interface PaginatorContext {
  host: Signal<Element | null>;
  rootClass: () => string;
  navLabel: () => string;
  cells: () => PageCell[];
  isPage: (cell: PageCell) => boolean;
  pageLabel: (cell: PageCell) => string;
  pageCurrent: (cell: PageCell) => string | undefined;
  isDisabled: () => boolean;
  goTo: (page: number) => void;
  prev: () => void;
  next: () => void;
  prevDisabled: () => boolean;
  nextDisabled: () => boolean;
  showRange: () => boolean;
  rangeText: () => string;
  showJump: () => boolean;
  jumpLabel: () => string;
  pageCount: () => number;
  currentPage: () => number;
  onJumpKeydown: (event: KeyboardEvent) => void;
  hasSizeOptions: () => boolean;
  sizeText: () => string;
  menu: typeof menu;
  sizeMenuConfig: MenuOptions;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i: number = start; i <= end; i += 1) out.push(i);
  return out;
}

// The windowed page run: boundary pages pinned at each end, `siblings` around the
// current page, gaps collapsed to a single 'ellipsis'. A one-page gap shows the page
// instead of an ellipsis (never "1 … 3" when "1 2 3" fits).
function buildCells(current: number, total: number, siblings: number, boundary: number): PageCell[] {
  const totalNumbers: number = siblings * 2 + 3 + boundary * 2;
  if (total <= totalNumbers + 2) return range(1, total);

  const leftSibling: number = Math.max(current - siblings, boundary + 2);
  const rightSibling: number = Math.min(current + siblings, total - boundary - 1);
  const showLeftEllipsis: boolean = leftSibling > boundary + 2;
  const showRightEllipsis: boolean = rightSibling < total - boundary - 1;

  const cells: PageCell[] = [...range(1, boundary)];
  if (showLeftEllipsis) cells.push('ellipsis');
  else cells.push(...range(boundary + 1, leftSibling - 1));
  cells.push(...range(leftSibling, rightSibling));
  if (showRightEllipsis) cells.push('ellipsis');
  else cells.push(...range(rightSibling + 1, total - boundary));
  cells.push(...range(total - boundary + 1, total));
  return cells;
}

export function setup(props: PaginatorProps): PaginatorContext {
  const host: Signal<Element | null> = signal<Element | null>(null);

  const length = (): number => Math.max(0, props.length ?? 0);
  const pageSize = (): number => Math.max(1, props.pageSize ?? 1);
  const pageCount = (): number => Math.max(1, Math.ceil(length() / pageSize()));
  // Clamp the incoming index to the valid range.
  const pageIndex = (): number => Math.min(Math.max(0, props.pageIndex ?? 0), pageCount() - 1);
  const currentPage = (): number => pageIndex() + 1;
  const disabled = (): boolean => !!props.disabled;

  const emit = (nextIndex: number, nextSize: number): void => {
    props.onPage?.({ pageIndex: nextIndex, pageSize: nextSize, length: length() });
  };

  const goToIndex = (index: number): void => {
    if (disabled()) return;
    const clamped: number = Math.min(Math.max(0, index), pageCount() - 1);
    if (clamped === pageIndex()) return;
    emit(clamped, pageSize());
  };

  const changeSize = (size: number): void => {
    if (disabled() || size === pageSize()) return;
    // Keep the first visible item on screen when the page size changes.
    const firstItem: number = pageIndex() * pageSize();
    const nextIndex: number = Math.floor(firstItem / size);
    props.onPage?.({ pageIndex: nextIndex, pageSize: size, length: length() });
  };

  const sizeMenuConfig: MenuOptions = {
    items: (props.pageSizeOptions ?? []).map((n) => ({ value: String(n), label: `${n} / page` })),
    onSelect: (selected: string | MenuItem): void =>
      changeSize(Number(typeof selected === 'string' ? selected : selected.value)),
  };

  return {
    host,
    rootClass: (): string => {
      const parts: string[] = ['weave-paginator'];
      if (disabled()) parts.push('weave-paginator--disabled');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    navLabel: (): string => props.label ?? 'Pagination',
    cells: (): PageCell[] =>
      buildCells(currentPage(), pageCount(), props.siblingCount ?? 1, props.boundaryCount ?? 1),
    isPage: (cell): boolean => typeof cell === 'number',
    pageLabel: (cell): string => `Go to page ${cell}`,
    pageCurrent: (cell): string | undefined => (cell === currentPage() ? 'page' : undefined),
    isDisabled: (): boolean => disabled(),
    goTo: (page): void => goToIndex(page - 1),
    prev: (): void => goToIndex(pageIndex() - 1),
    next: (): void => goToIndex(pageIndex() + 1),
    prevDisabled: (): boolean => disabled() || pageIndex() <= 0,
    nextDisabled: (): boolean => disabled() || pageIndex() >= pageCount() - 1,
    showRange: (): boolean => props.showRange !== false,
    rangeText: (): string => {
      const total: number = length();
      if (total === 0) return '0 of 0';
      const start: number = pageIndex() * pageSize() + 1;
      const end: number = Math.min(total, (pageIndex() + 1) * pageSize());
      return `${start}–${end} of ${total}`;
    },
    showJump: (): boolean => props.showJump !== false,
    jumpLabel: (): string => props.jumpLabel ?? 'Go to',
    pageCount,
    currentPage,
    onJumpKeydown: (event): void => {
      if (event.key !== 'Enter') return;
      const input: HTMLInputElement = event.target as HTMLInputElement;
      const target: number = parseInt(input.value, 10);
      if (Number.isFinite(target)) goToIndex(target - 1);
      event.preventDefault();
    },
    hasSizeOptions: (): boolean => (props.pageSizeOptions?.length ?? 0) > 0,
    sizeText: (): string => `${pageSize()} / page`,
    menu,
    sizeMenuConfig,
  };
}
