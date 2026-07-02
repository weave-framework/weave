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
import { setup, template, type PaginatorProps, type PaginatorContext, type PageEvent } from '@weave-framework/ui/paginator';
import * as InputMod from '@weave-framework/ui/input';
import * as SelectMod from '@weave-framework/ui/select';
import * as ButtonMod from '@weave-framework/ui/button';
import { toComponent } from '../internal/compose.js';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = [
  'host', 'rootClass', 'navLabel', 'cells', 'isPage', 'pageLabel', 'pageCurrent', 'pageVariant', 'isDisabled',
  'goTo', 'prev', 'next', 'prevDisabled', 'nextDisabled', 'showRange', 'rangeText', 'showJump',
  'jumpLabel', 'jumpValue', 'pageCount', 'currentPage', 'onJumpKeydown', 'hasSizeOptions',
  'sizeOptions', 'sizeValue', 'onSizeChange',
];

interface Mounted {
  nav: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  pages: HTMLButtonElement[];
  range: HTMLElement | null;
  jump: HTMLInputElement | null;
  size: HTMLElement | null;
  sequence: () => string[];
  dispose: () => void;
}

function mount(props: PaginatorProps): Mounted {
  const owner: Owner = createOwner();
  const nav: HTMLElement = runInOwner(owner, () => {
    const ctx: PaginatorContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    // Page/nav buttons are <Button>, the jump field <Input>, the page-size <Select>.
    return fn(ctx, rt, {
      Button: toComponent(ButtonMod as never),
      Input: toComponent(InputMod as never),
      Select: toComponent(SelectMod as never),
    });
  });
  document.body.appendChild(nav);
  const q = <T extends Element>(s: string): T[] => Array.from(nav.querySelectorAll<T>(s));
  return {
    nav,
    prev: nav.querySelectorAll<HTMLButtonElement>('.weave-paginator__nav')[0],
    next: nav.querySelectorAll<HTMLButtonElement>('.weave-paginator__nav')[1],
    pages: q<HTMLButtonElement>('.weave-paginator__page'),
    range: nav.querySelector<HTMLElement>('.weave-paginator__range'),
    // The composed Input's native field / the composed Select's root.
    jump: nav.querySelector<HTMLInputElement>('.weave-paginator__jump-field input'),
    size: nav.querySelector<HTMLElement>('.weave-paginator__size'),
    // The ordered run of page numbers + ellipses (nav arrows excluded).
    sequence: (): string[] =>
      Array.from(nav.querySelectorAll<HTMLElement>('.weave-paginator__page, .weave-paginator__ellipsis')).map(
        (el) => el.textContent?.trim() ?? ''
      ),
    dispose: (): void => { disposeOwner(owner); nav.remove(); },
  };
}

// length so that ceil(length/size) === pages
const withPages = (pages: number, index: number, extra: Partial<PaginatorProps> = {}): PaginatorProps => ({
  length: pages * 10,
  pageSize: 10,
  pageIndex: index,
  ...extra,
});

/* ─────────────────────────── windowing ─────────────────────────── */

test('few pages: shows them all, no ellipsis', () => {
  const { sequence, dispose } = mount(withPages(5, 2));
  assert.deepEqual(sequence(), ['1', '2', '3', '4', '5']);
  dispose();
});

test('100 pages, middle: boundary + sibling window + both ellipses', () => {
  const { sequence, dispose } = mount(withPages(100, 5)); // page 6
  assert.deepEqual(sequence(), ['1', '…', '5', '6', '7', '…', '100']);
  dispose();
});

test('100 pages, near start: no left ellipsis', () => {
  const { sequence, dispose } = mount(withPages(100, 1)); // page 2
  assert.deepEqual(sequence(), ['1', '2', '3', '…', '100']);
  dispose();
});

test('100 pages, near end: no right ellipsis', () => {
  const { sequence, dispose } = mount(withPages(100, 98)); // page 99
  assert.deepEqual(sequence(), ['1', '…', '98', '99', '100']);
  dispose();
});

test('siblingCount widens the window', () => {
  const { sequence, dispose } = mount(withPages(100, 5, { siblingCount: 2 }));
  assert.deepEqual(sequence(), ['1', '…', '4', '5', '6', '7', '8', '…', '100']);
  dispose();
});

/* ─────────────────────────── active + a11y ─────────────────────────── */

test('the active page has aria-current=page; the nav is a labelled landmark', () => {
  const { nav, pages, dispose } = mount(withPages(5, 2));
  assert.equal(nav.tagName, 'NAV');
  assert.equal(nav.getAttribute('aria-label'), 'Pagination');
  const active: HTMLButtonElement | undefined = pages.find((p) => p.getAttribute('aria-current') === 'page');
  assert.equal(active?.textContent, '3');
  assert.equal(pages[0].getAttribute('aria-label'), 'Go to page 1');
  dispose();
});

/* ─────────────────────────── navigation ─────────────────────────── */

test('prev/next call onPage with the neighbour index and disable at the ends', () => {
  const seen: PageEvent[] = [];
  const { prev, next, dispose } = mount(withPages(10, 0, { onPage: (e): void => { seen.push(e); } }));
  assert.equal(prev.disabled, true, 'prev disabled on the first page');
  assert.equal(next.disabled, false);
  next.click();
  assert.deepEqual(seen.at(-1), { pageIndex: 1, pageSize: 10, length: 100 });
  dispose();
});

test('next is disabled on the last page', () => {
  const { prev, next, dispose } = mount(withPages(10, 9));
  assert.equal(next.disabled, true);
  assert.equal(prev.disabled, false);
  dispose();
});

test('clicking a page button navigates to it', () => {
  const seen: PageEvent[] = [];
  const { pages, dispose } = mount(withPages(100, 5, { onPage: (e): void => { seen.push(e); } }));
  const p7: HTMLButtonElement = pages.find((p) => p.textContent === '7')!;
  p7.click();
  assert.equal(seen.at(-1)?.pageIndex, 6);
  dispose();
});

test('an out-of-range pageIndex is clamped', () => {
  const { pages, range, dispose } = mount(withPages(5, 99)); // asks for page 100 of 5
  assert.ok(pages.find((p) => p.getAttribute('aria-current') === 'page')?.textContent === '5');
  assert.equal(range?.textContent, '41–50 of 50');
  dispose();
});

/* ─────────────────────────── range label ─────────────────────────── */

test('range label reads N–M of T; empty length reads 0 of 0', () => {
  const { range, dispose } = mount(withPages(10, 2)); // page 3, size 10, length 100
  assert.equal(range?.textContent, '21–30 of 100');
  dispose();
  const empty: Mounted = mount({ length: 0, pageSize: 10, pageIndex: 0 });
  assert.equal(empty.range?.textContent, '0 of 0');
  empty.dispose();
});

test('the last page range clamps to the total', () => {
  const { range, dispose } = mount({ length: 95, pageSize: 10, pageIndex: 9 }); // 10 pages, last has 5
  assert.equal(range?.textContent, '91–95 of 95');
  dispose();
});

/* ─────────────────────────── manual jump ─────────────────────────── */

test('typing a page + Enter navigates; the input shows the current page', () => {
  const seen: PageEvent[] = [];
  const { jump, dispose } = mount(withPages(100, 0, { onPage: (e): void => { seen.push(e); } }));
  assert.ok(jump, 'jump input shown by default');
  assert.equal(jump?.value, '1', 'shows the current page');
  jump!.value = '73';
  jump!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(seen.at(-1)?.pageIndex, 72);
  dispose();
});

test('a jump beyond the range is clamped', () => {
  const seen: PageEvent[] = [];
  const { jump, dispose } = mount(withPages(10, 0, { onPage: (e): void => { seen.push(e); } }));
  jump!.value = '999';
  jump!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(seen.at(-1)?.pageIndex, 9, 'clamped to the last page');
  dispose();
});

test('showJump={{false}} hides the input', () => {
  const { jump, dispose } = mount(withPages(10, 0, { showJump: false }));
  assert.equal(jump, null);
  dispose();
});

/* ─────────────────────────── page-size menu ─────────────────────────── */

test('pageSizeOptions renders a composed Select showing the size; none hides it', () => {
  const { size, dispose } = mount(withPages(10, 0, { pageSizeOptions: [10, 25, 50] }));
  assert.ok(size, 'the page-size Select is shown when options are given');
  assert.ok(size?.classList.contains('weave-select'), 'it IS the Select component');
  assert.ok(size?.textContent?.includes('10 / page'), 'the trigger shows the current size');
  dispose();
  const none: Mounted = mount(withPages(10, 0));
  assert.equal(none.size, null);
  none.dispose();
});

/* ─────────────────────────── disabled + class ─────────────────────────── */

test('disabled: buttons inert, modifier applied', () => {
  const seen: PageEvent[] = [];
  const { next, pages, nav, dispose } = mount(withPages(10, 0, { disabled: true, onPage: (e): void => { seen.push(e); } }));
  assert.ok(nav.classList.contains('weave-paginator--disabled'));
  assert.equal(next.disabled, true);
  pages[1]?.click();
  assert.equal(seen.length, 0, 'no navigation while disabled');
  dispose();
});

test('forwards a custom class onto the nav', () => {
  const { nav, dispose } = mount(withPages(5, 0, { class: 'my-pager' }));
  assert.ok(nav.classList.contains('weave-paginator') && nav.classList.contains('my-pager'));
  dispose();
});
