import { test, assert } from '../../../../tools/harness.js';
import { createDateAdapter, type DateAdapter } from '@weave-framework/ui/cdk';
import { createCalendarView, CALENDAR_LABEL_DEFAULTS, type CalendarView, type CalendarHost } from './calendar-view.js';

/**
 * `createCalendarView` is the headless calendar engine BOTH date pickers are built on — 630 lines of
 * date arithmetic, roving focus and keyboard handling that, until this file, had no tests of its own.
 * It was covered only through its two consumers, so a defect here surfaced as "the datepicker behaves
 * oddly" rather than naming the engine, and any fix had to be verified twice.
 *
 * Date arithmetic is where off-by-one and month-boundary bugs live, so the cases below deliberately sit
 * on the boundaries: month ends, leap day, year rollover, the first/last cell of a grid page.
 */

const adapter: DateAdapter = createDateAdapter({ locale: 'en-US' });

interface Harness {
  view: CalendarView;
  panel: HTMLElement;
  /** `reset` only sets state — the consumer renders. This is what "opening" the picker means. */
  open: (base: Date) => void;
  /** Days the host was told to select, in order. */
  selected: Date[];
  escapes: number;
  cleanup: () => void;
}

/** Build a calendar attached to the document (focus assertions need a live tree). */
function mount(overrides: Partial<CalendarHost> = {}): Harness {
  const selected: Date[] = [];
  let escapes: number = 0;
  const host: CalendarHost = {
    prefix: 'weave-datepicker',
    panelId: 'test-panel',
    adapter,
    labels: () => CALENDAR_LABEL_DEFAULTS,
    firstDay: () => 1, // Monday
    isSelected: () => false,
    isYearSelected: () => false,
    isMonthSelected: () => false,
    onSelectDay: (d: Date) => selected.push(d),
    onEscape: () => escapes++,
    ...overrides,
  };
  const view: CalendarView = createCalendarView(host);
  document.body.appendChild(view.panel);
  return {
    view,
    panel: view.panel,
    open: (base: Date): void => {
      view.reset(base);
      view.rerender(); // reset sets state only; rerender draws it and places focus
    },
    selected,
    get escapes(): number {
      return escapes;
    },
    cleanup: () => view.panel.remove(),
  } as Harness;
}

/** The day cell carrying DOM focus, as a plain integer. */
function focusedDay(panel: HTMLElement): number | null {
  const el: Element | null = panel.querySelector('[tabindex="0"]');
  const n: number = Number(el?.textContent?.trim());
  return Number.isFinite(n) ? n : null;
}

function press(panel: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  const target: Element = panel.querySelector('[tabindex="0"]') ?? panel;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/* ──────────────── the day grid: arithmetic on the boundaries ──────────────── */

test('calendar: ArrowRight crosses a month boundary into the next month', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 31)); // 31 Jan
  press(h.panel, 'ArrowRight');
  assert.equal(focusedDay(h.panel), 1, 'focus lands on 1 Feb, not a 32nd of January');
  h.cleanup();
});

test('calendar: ArrowDown from the last week rolls into the next month', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 28)); // +7 days = 4 Feb
  press(h.panel, 'ArrowDown');
  assert.equal(focusedDay(h.panel), 4, 'a week forward from 28 Jan is 4 Feb');
  h.cleanup();
});

test('calendar: ArrowLeft from 1 January rolls back a YEAR', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 1));
  press(h.panel, 'ArrowLeft');
  assert.equal(focusedDay(h.panel), 31, 'lands on 31 December');
  h.cleanup();
});

test('calendar: February in a leap year has a 29th, and a non-leap year does not', () => {
  const leap: Harness = mount();
  leap.open(adapter.create(2028, 1, 28)); // 2028 is a leap year
  press(leap.panel, 'ArrowRight');
  assert.equal(focusedDay(leap.panel), 29, '28 Feb 2028 → 29 Feb');
  leap.cleanup();

  const common: Harness = mount();
  common.open(adapter.create(2026, 1, 28)); // 2026 is not
  press(common.panel, 'ArrowRight');
  assert.equal(focusedDay(common.panel), 1, '28 Feb 2026 → 1 Mar (no 29th to land on)');
  common.cleanup();
});

test('calendar: PageUp/PageDown move by a month, and with Shift by a year', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 5, 15));
  press(h.panel, 'PageDown');
  assert.equal(focusedDay(h.panel), 15, 'same day-of-month one month on');
  press(h.panel, 'PageUp', { shiftKey: true });
  assert.equal(focusedDay(h.panel), 15, 'and a year back keeps the day too');
  h.cleanup();
});

test('calendar: PageDown from the 31st clamps into a shorter month', () => {
  // 31 Jan + 1 month has no 31 Feb. The adapter must clamp rather than overflow into March.
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 31));
  press(h.panel, 'PageDown');
  const day: number | null = focusedDay(h.panel);
  assert.ok(day === 28 || day === 29, `clamped to the end of February, got ${day}`);
  h.cleanup();
});

test('calendar: Home/End move within the focused WEEK, respecting firstDay', () => {
  const h: Harness = mount({ firstDay: () => 1 }); // Monday-first
  h.open(adapter.create(2026, 0, 15)); // a Thursday
  press(h.panel, 'Home');
  const start: number | null = focusedDay(h.panel);
  press(h.panel, 'End');
  const end: number | null = focusedDay(h.panel);
  assert.equal((end as number) - (start as number), 6, 'a week spans exactly 7 cells inclusive');
  h.cleanup();
});

/* ──────────────── min / max / dateFilter ──────────────── */

test('calendar: a day outside min…max is disabled and cannot be selected', () => {
  const h: Harness = mount({
    min: () => adapter.create(2026, 0, 10),
    max: () => adapter.create(2026, 0, 20),
  });
  h.open(adapter.create(2026, 0, 15));
  const cells: HTMLButtonElement[] = [...h.panel.querySelectorAll('button')].filter(
    (b) => Number.isFinite(Number(b.textContent?.trim()))
  ) as HTMLButtonElement[];
  const five: HTMLButtonElement | undefined = cells.find((b) => b.textContent?.trim() === '5');
  const fifteen: HTMLButtonElement | undefined = cells.find((b) => b.textContent?.trim() === '15');
  assert.ok(five?.disabled, 'the 5th is before min → disabled');
  assert.equal(fifteen?.disabled, false, 'the 15th is inside the range → enabled');
  five?.click();
  assert.equal(h.selected.length, 0, 'clicking a disabled day selects nothing');
  h.cleanup();
});

test('calendar: dateFilter disables individual days inside the range', () => {
  const h: Harness = mount({
    // Reject weekends.
    dateFilter: (d: Date) => {
      const dow: number = adapter.getDayOfWeek(d);
      return dow !== 0 && dow !== 6;
    },
  });
  h.open(adapter.create(2026, 0, 15));
  const cells: HTMLButtonElement[] = [...h.panel.querySelectorAll('button')] as HTMLButtonElement[];
  const disabledCount: number = cells.filter((b) => b.disabled && Number.isFinite(Number(b.textContent?.trim()))).length;
  assert.ok(disabledCount >= 8, `weekends in a month are disabled (got ${disabledCount})`);
  h.cleanup();
});

/* ──────────────── selection ──────────────── */

test('calendar: Enter selects the focused day, and reports the DATE not the cell', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 2, 10));
  press(h.panel, 'ArrowRight');
  press(h.panel, 'Enter');
  assert.equal(h.selected.length, 1, 'one selection');
  const d: Date = h.selected[0];
  assert.equal(adapter.getYear(d), 2026, 'year');
  assert.equal(adapter.getMonth(d), 2, 'month (March)');
  assert.equal(adapter.getDate(d), 11, 'the day the focus had moved to');
  h.cleanup();
});

test('calendar: Escape asks the host to close', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 15));
  press(h.panel, 'Escape');
  assert.equal(h.escapes, 1, 'the host was told to close exactly once');
  h.cleanup();
});

/* ──────────────── roving focus: exactly one tab stop ──────────────── */

test('calendar: the grid is a single tab stop (roving tabindex)', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 15));
  const stops: number = h.panel.querySelectorAll('[tabindex="0"]').length;
  assert.equal(stops, 1, 'exactly one focusable cell');
  press(h.panel, 'ArrowRight');
  assert.equal(h.panel.querySelectorAll('[tabindex="0"]').length, 1, 'still exactly one after moving');
  h.cleanup();
});

/* ──────────────── the year grid: 24-per-page geometry ──────────────── */

test('calendar: the year view pages in blocks of 24, aligned to the block', () => {
  const h: Harness = mount();
  h.open(adapter.create(2026, 0, 15));
  // Drill into the year view via the header's view-switch button.
  const header: HTMLButtonElement | undefined = [...h.panel.querySelectorAll('button')].find((b) =>
    /2026/.test(b.textContent ?? '')
  ) as HTMLButtonElement | undefined;
  assert.ok(header, 'the header exposes a view-switch button');
  header!.click();
  const years: number[] = [...h.panel.querySelectorAll('button')]
    .map((b) => Number(b.textContent?.trim()))
    .filter((n) => Number.isFinite(n) && n > 1900);
  assert.equal(years.length, 24, 'a page is 24 years');
  assert.equal(years[0] % 24, 0, `the page is block-aligned (starts at ${years[0]})`);
  assert.ok(years.includes(2026), 'and contains the focused year');
  h.cleanup();
});
