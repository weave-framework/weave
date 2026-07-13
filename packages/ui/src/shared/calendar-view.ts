/**
 * `createCalendarView` — the headless calendar engine shared by `<Datepicker>` and
 * `<DateRangePicker>`. It owns the three drill-down views (a `role=grid` **day** view, a
 * **year** grid of 24, a **month** grid), the ‹/› nav + header view-switch, roving focus, and
 * all keyboard handling. What it does *not* own: how a chosen day maps to a value (single date
 * vs a range) — that is the host's job via {@link CalendarHost.onSelectDay} + the day-cell
 * decoration hooks. All date math flows through the zero-dep CDK {@link DateAdapter}.
 *
 * Class names are parameterised by `prefix` (e.g. `'weave-datepicker'`) so each consumer keeps
 * its own SCSS while sharing this one behavior implementation (UI RULE #1 — no duplication).
 */
import { activeDirection, type DateAdapter } from '../cdk/index.js';

/**
 * Translatable chrome strings for the calendar popover — the accessible names of the nav
 * buttons and the view-switch header, plus the dialog's own name. Month / weekday / year *text*
 * is not here; it comes from the adapter's locale (Intl). Every value may be a `t('…')` result.
 */
export interface CalendarLabels {
  /** ‹ in the day view — step to the previous month. */
  prevMonth: string;
  /** › in the day view — step to the next month. */
  nextMonth: string;
  /** ‹ in the year view — jump to the previous page of years. */
  prevYearRange: string;
  /** › in the year view — jump to the next page of years. */
  nextYearRange: string;
  /** Accessible name of the header button that opens the year grid (day + month views). */
  chooseYear: string;
  /** The dialog's accessible name. */
  calendarLabel: string;
}

/** The English defaults for {@link CalendarLabels} — hosts overlay their `labels` prop on top. */
export const CALENDAR_LABEL_DEFAULTS: CalendarLabels = {
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  prevYearRange: 'Previous years',
  nextYearRange: 'Next years',
  chooseYear: 'Choose year',
  calendarLabel: 'Choose date',
};

/** What the host supplies to drive the shared calendar. */
export interface CalendarHost {
  /** BEM-ish class prefix for the panel + grids (e.g. `'weave-datepicker'`). */
  prefix: string;
  /** Unique DOM id for the dialog panel (for the trigger's `aria-controls`). */
  panelId: string;
  adapter: DateAdapter;
  /** The (reactive) chrome labels. */
  labels: () => CalendarLabels;
  /** First day of the week, `0` Sunday … `6` Saturday. */
  firstDay: () => number;
  /** Earliest selectable date (inclusive), if any. */
  min?: () => Date | undefined;
  /** Latest selectable date (inclusive), if any. */
  max?: () => Date | undefined;
  /** Return false to disable a specific date. */
  dateFilter?: (date: Date) => boolean;
  /** True → the day gets the accent-fill `--selected` class + `aria-selected` (a range marks both ends). */
  isSelected: (date: Date) => boolean;
  /** True → the year cell is marked selected. */
  isYearSelected: (year: number) => boolean;
  /** True → the month cell (of `year`) is marked selected. */
  isMonthSelected: (year: number, month: number) => boolean;
  /** Add host-specific state to a real day cell (range in-between / preview / range ends). */
  decorateDay?: (date: Date, btn: HTMLButtonElement, disabled: boolean) => void;
  /** A day was activated (click / Enter / Space). Host commits or extends its value, then re-renders. */
  onSelectDay: (date: Date) => void;
  /** Pointer entered a day cell — for range hover preview. */
  onHoverDay?: (date: Date) => void;
  /** Pointer left the day grid. */
  onHoverLeave?: () => void;
  /** Escape pressed inside a grid — host closes the panel. */
  onEscape: () => void;
}

/** The controller the host holds onto. */
export interface CalendarView {
  /** The `role=dialog` panel element (attach it to your overlay). */
  readonly panel: HTMLElement;
  /** Enter the day view anchored + focused at `base` (call on open). */
  reset(base: Date): void;
  /** Re-render the current view in place (no focus side effect). */
  render(): void;
  /** Re-render then move DOM focus onto the active cell (nav / view switch / keyboard). */
  rerender(): void;
  /** Move DOM focus onto the active cell of the current view. */
  focusActive(): void;
}

/** The calendar's drill-down views, coarsest-last. */
type CalendarViewName = 'day' | 'year' | 'month';

/** Year grid geometry — a page of 24 years, 4 across. */
const YEARS_PER_PAGE: number = 24;
const YEAR_COLS: number = 4;
/** Month grid — the 12 months, 3 across. */
const MONTH_COLS: number = 3;

/** Non-negative modulo (JS `%` keeps the sign of the dividend). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function createCalendarView(host: CalendarHost): CalendarView {
  const adapter: DateAdapter = host.adapter;
  const p: string = host.prefix;

  let view: CalendarViewName = 'day';
  let viewMonth: Date = adapter.startOfMonth(adapter.today());
  let focusedDate: Date = adapter.today();
  let focusedYear: number = adapter.getYear(focusedDate);
  let focusedMonth: number = adapter.getMonth(focusedDate);
  let rangeStart: number = focusedYear - mod(focusedYear, YEARS_PER_PAGE);

  const minDate = (): Date | undefined => host.min?.();
  const maxDate = (): Date | undefined => host.max?.();

  const dateDisabled = (date: Date): boolean => {
    const lo: Date | undefined = minDate();
    const hi: Date | undefined = maxDate();
    return (
      (!!lo && adapter.compare(date, lo) < 0) ||
      (!!hi && adapter.compare(date, hi) > 0) ||
      (!!host.dateFilter && !host.dateFilter(date))
    );
  };
  // A whole year / month is disabled only when it lies entirely outside min…max (day-level
  // `dateFilter` still applies once you drill into the day grid).
  const yearDisabled = (year: number): boolean => {
    const lo: Date | undefined = minDate();
    const hi: Date | undefined = maxDate();
    return (!!lo && year < adapter.getYear(lo)) || (!!hi && year > adapter.getYear(hi));
  };
  const monthDisabled = (year: number, month: number): boolean => {
    const lo: Date | undefined = minDate();
    const hi: Date | undefined = maxDate();
    const start: Date = adapter.create(year, month, 1);
    const end: Date = adapter.create(year, month, adapter.getDaysInMonth(start));
    return (!!lo && adapter.compare(end, lo) < 0) || (!!hi && adapter.compare(start, hi) > 0);
  };

  const clampFocus = (date: Date): Date => adapter.clamp(date, minDate(), maxDate());
  const clampYear = (year: number): number => {
    let y: number = year;
    const lo: Date | undefined = minDate();
    const hi: Date | undefined = maxDate();
    if (lo) y = Math.max(y, adapter.getYear(lo));
    if (hi) y = Math.min(y, adapter.getYear(hi));
    return y;
  };

  /* ── the panel (built once; content re-rendered on nav / view switch) ── */
  const panel: HTMLElement = document.createElement('div');
  panel.className = `${p}__panel`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.id = host.panelId;
  const content: HTMLElement = document.createElement('div');
  content.className = `${p}__content`;
  panel.append(content);

  function navButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.className = `${p}__nav-button`;
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }

  // The header's centre control — a `<button>` that switches to a coarser view (day/month → year).
  function viewSwitch(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.className = `${p}__month-label ${p}__view-switch`;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-live', 'polite');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function gridRow(cls: string): HTMLElement {
    const r: HTMLElement = document.createElement('div');
    r.className = cls;
    r.setAttribute('role', 'row');
    return r;
  }

  function render(): void {
    panel.setAttribute('aria-label', host.labels().calendarLabel);
    content.textContent = '';
    if (view === 'day') renderDayView();
    else if (view === 'year') renderYearView();
    else renderMonthView();
  }

  function rerender(): void {
    render();
    focusActive();
  }

  function focusActive(): void {
    content.querySelector<HTMLElement>('[data-focused="true"]')?.focus();
  }

  /* ── day view ── */
  function renderDayView(): void {
    const header: HTMLElement = document.createElement('div');
    header.className = `${p}__nav`;
    const prev: HTMLButtonElement = navButton('‹', host.labels().prevMonth, () => shiftMonth(-1));
    const next: HTMLButtonElement = navButton('›', host.labels().nextMonth, () => shiftMonth(1));
    const label: HTMLButtonElement = viewSwitch(
      adapter.format(viewMonth, { month: 'long', year: 'numeric' }),
      host.labels().chooseYear,
      openYearView
    );
    header.append(prev, label, next);

    const weekdays: HTMLElement = document.createElement('div');
    weekdays.className = `${p}__weekdays`;
    const first: number = host.firstDay();
    const names: string[] = adapter.getDayOfWeekNames('narrow');
    for (let i: number = 0; i < 7; i++) {
      const cell: HTMLElement = document.createElement('span');
      cell.className = `${p}__weekday`;
      cell.textContent = names[(first + i) % 7];
      weekdays.appendChild(cell);
    }

    const grid: HTMLElement = document.createElement('div');
    grid.className = `${p}__grid`;
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onGridKeydown);
    if (host.onHoverLeave) grid.addEventListener('mouseleave', host.onHoverLeave);
    fillDayGrid(grid, first);

    content.append(header, weekdays, grid);
  }

  function fillDayGrid(grid: HTMLElement, first: number): void {
    const today: Date = adapter.today();
    const monthStart: Date = adapter.startOfMonth(viewMonth);
    const startWeekday: number = adapter.getDayOfWeek(monthStart);
    const lead: number = (startWeekday - first + 7) % 7;
    const days: number = adapter.getDaysInMonth(viewMonth);
    const total: number = Math.ceil((lead + days) / 7) * 7;

    let row: HTMLElement = gridRow(`${p}__row`);
    for (let cell: number = 0; cell < total; cell++) {
      if (cell > 0 && cell % 7 === 0) {
        grid.appendChild(row);
        row = gridRow(`${p}__row`);
      }
      const dayNum: number = cell - lead + 1;
      if (dayNum < 1 || dayNum > days) {
        const blank: HTMLElement = document.createElement('span');
        blank.className = `${p}__cell ${p}__cell--blank`;
        blank.setAttribute('role', 'gridcell');
        row.appendChild(blank);
        continue;
      }
      const date: Date = adapter.create(adapter.getYear(viewMonth), adapter.getMonth(viewMonth), dayNum);
      row.appendChild(dayCell(date, today));
    }
    grid.appendChild(row);
  }

  function dayCell(date: Date, today: Date): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = `${p}__cell`;
    btn.setAttribute('role', 'gridcell');
    btn.textContent = String(adapter.getDate(date));
    const disabled: boolean = dateDisabled(date);
    const isFocused: boolean = adapter.isSameDay(date, focusedDate);
    if (disabled) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add(`${p}__cell--disabled`);
    }
    if (host.isSelected(date)) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add(`${p}__cell--selected`);
    }
    if (adapter.isSameDay(date, today)) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add(`${p}__cell--today`);
    }
    host.decorateDay?.(date, btn, disabled);
    btn.tabIndex = isFocused ? 0 : -1;
    if (isFocused) btn.setAttribute('data-focused', 'true');
    btn.addEventListener('click', () => activateDay(date));
    if (host.onHoverDay && !disabled) btn.addEventListener('mouseenter', () => host.onHoverDay!(date));
    return btn;
  }

  function activateDay(date: Date): void {
    if (dateDisabled(date)) return;
    host.onSelectDay(adapter.clone(date));
  }

  function moveFocus(next: Date): void {
    focusedDate = clampFocus(next);
    if (!adapter.isSameDay(adapter.startOfMonth(focusedDate), viewMonth)) {
      viewMonth = adapter.startOfMonth(focusedDate);
    }
    rerender();
  }

  function shiftMonth(delta: number): void {
    focusedDate = clampFocus(adapter.addMonths(focusedDate, delta));
    viewMonth = adapter.startOfMonth(focusedDate);
    rerender();
  }

  function onGridKeydown(event: KeyboardEvent): void {
    const key: string = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      host.onEscape();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      activateDay(focusedDate);
      return;
    }
    let handled: boolean = true;
    // In RTL the grid runs right-to-left, so ArrowLeft moves to the next day, ArrowRight to the previous.
    const dayStep: number = activeDirection() === 'rtl' ? -1 : 1;
    if (key === 'ArrowLeft') moveFocus(adapter.addDays(focusedDate, -dayStep));
    else if (key === 'ArrowRight') moveFocus(adapter.addDays(focusedDate, dayStep));
    else if (key === 'ArrowUp') moveFocus(adapter.addDays(focusedDate, -7));
    else if (key === 'ArrowDown') moveFocus(adapter.addDays(focusedDate, 7));
    else if (key === 'Home') moveFocus(startOfWeek(focusedDate));
    else if (key === 'End') moveFocus(adapter.addDays(startOfWeek(focusedDate), 6));
    else if (key === 'PageUp') moveFocus(adapter.addMonths(focusedDate, event.shiftKey ? -12 : -1));
    else if (key === 'PageDown') moveFocus(adapter.addMonths(focusedDate, event.shiftKey ? 12 : 1));
    else handled = false;
    if (handled) event.preventDefault();
  }

  function startOfWeek(date: Date): Date {
    const first: number = host.firstDay();
    const offset: number = (adapter.getDayOfWeek(date) - first + 7) % 7;
    return adapter.addDays(date, -offset);
  }

  /* ── year view (a page of 24 years) ── */
  function openYearView(): void {
    view = 'year';
    focusedYear = clampYear(adapter.getYear(viewMonth));
    rangeStart = focusedYear - mod(focusedYear, YEARS_PER_PAGE);
    rerender();
  }

  function renderYearView(): void {
    const header: HTMLElement = document.createElement('div');
    header.className = `${p}__nav`;
    const prev: HTMLButtonElement = navButton('‹', host.labels().prevYearRange, () => shiftYearRange(-1));
    const next: HTMLButtonElement = navButton('›', host.labels().nextYearRange, () => shiftYearRange(1));
    const endYear: number = rangeStart + YEARS_PER_PAGE - 1;
    const range: HTMLElement = document.createElement('span');
    range.className = `${p}__month-label ${p}__range-label`;
    range.setAttribute('aria-live', 'polite');
    range.textContent = `${yearText(rangeStart)} – ${yearText(endYear)}`;
    header.append(prev, range, next);

    const grid: HTMLElement = document.createElement('div');
    grid.className = `${p}__year-grid`;
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onYearKeydown);

    const curYear: number = adapter.getYear(adapter.today());
    let row: HTMLElement = gridRow(`${p}__year-row`);
    for (let i: number = 0; i < YEARS_PER_PAGE; i++) {
      if (i > 0 && i % YEAR_COLS === 0) {
        grid.appendChild(row);
        row = gridRow(`${p}__year-row`);
      }
      row.appendChild(yearCell(rangeStart + i, curYear));
    }
    grid.appendChild(row);
    content.append(header, grid);
  }

  function yearCell(year: number, curYear: number): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = `${p}__year-cell`;
    btn.setAttribute('role', 'gridcell');
    btn.textContent = yearText(year);
    if (yearDisabled(year)) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add(`${p}__year-cell--disabled`);
    }
    if (host.isYearSelected(year)) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add(`${p}__year-cell--selected`);
    }
    if (curYear === year) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add(`${p}__year-cell--today`);
    }
    const isFocused: boolean = year === focusedYear;
    btn.tabIndex = isFocused ? 0 : -1;
    if (isFocused) btn.setAttribute('data-focused', 'true');
    btn.addEventListener('click', () => selectYear(year));
    return btn;
  }

  function moveYearFocus(nextYear: number): void {
    focusedYear = clampYear(nextYear);
    if (focusedYear < rangeStart || focusedYear > rangeStart + YEARS_PER_PAGE - 1) {
      rangeStart = focusedYear - mod(focusedYear, YEARS_PER_PAGE);
    }
    rerender();
  }

  function shiftYearRange(delta: number): void {
    rangeStart += delta * YEARS_PER_PAGE;
    focusedYear = clampYear(focusedYear + delta * YEARS_PER_PAGE);
    rerender();
  }

  function selectYear(year: number): void {
    if (yearDisabled(year)) return;
    viewMonth = adapter.startOfMonth(adapter.create(year, adapter.getMonth(viewMonth), 1));
    focusedMonth = adapter.getMonth(viewMonth);
    view = 'month';
    rerender();
  }

  function onYearKeydown(event: KeyboardEvent): void {
    const key: string = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      host.onEscape();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      selectYear(focusedYear);
      return;
    }
    let handled: boolean = true;
    const step: number = activeDirection() === 'rtl' ? -1 : 1;
    if (key === 'ArrowLeft') moveYearFocus(focusedYear - step);
    else if (key === 'ArrowRight') moveYearFocus(focusedYear + step);
    else if (key === 'ArrowUp') moveYearFocus(focusedYear - YEAR_COLS);
    else if (key === 'ArrowDown') moveYearFocus(focusedYear + YEAR_COLS);
    else if (key === 'Home') moveYearFocus(rangeStart);
    else if (key === 'End') moveYearFocus(rangeStart + YEARS_PER_PAGE - 1);
    else if (key === 'PageUp') moveYearFocus(focusedYear - YEARS_PER_PAGE);
    else if (key === 'PageDown') moveYearFocus(focusedYear + YEARS_PER_PAGE);
    else handled = false;
    if (handled) event.preventDefault();
  }

  /* ── month view (Jan–Dec of the chosen year) ── */
  function renderMonthView(): void {
    const header: HTMLElement = document.createElement('div');
    header.className = `${p}__nav ${p}__nav--center`;
    const year: number = adapter.getYear(viewMonth);
    const label: HTMLButtonElement = viewSwitch(yearText(year), host.labels().chooseYear, openYearView);
    header.append(label);

    const grid: HTMLElement = document.createElement('div');
    grid.className = `${p}__month-grid`;
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onMonthKeydown);

    const names: string[] = adapter.getMonthNames('short');
    const today: Date = adapter.today();
    const curMonth: number | null = adapter.getYear(today) === year ? adapter.getMonth(today) : null;

    let row: HTMLElement = gridRow(`${p}__month-row`);
    for (let m: number = 0; m < 12; m++) {
      if (m > 0 && m % MONTH_COLS === 0) {
        grid.appendChild(row);
        row = gridRow(`${p}__month-row`);
      }
      row.appendChild(monthCell(m, names[m], year, curMonth));
    }
    grid.appendChild(row);
    content.append(header, grid);
  }

  function monthCell(month: number, name: string, year: number, curMonth: number | null): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = `${p}__month-cell`;
    btn.setAttribute('role', 'gridcell');
    btn.textContent = name;
    if (monthDisabled(year, month)) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add(`${p}__month-cell--disabled`);
    }
    if (host.isMonthSelected(year, month)) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add(`${p}__month-cell--selected`);
    }
    if (curMonth === month) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add(`${p}__month-cell--today`);
    }
    const isFocused: boolean = month === focusedMonth;
    btn.tabIndex = isFocused ? 0 : -1;
    if (isFocused) btn.setAttribute('data-focused', 'true');
    btn.addEventListener('click', () => selectMonth(month));
    return btn;
  }

  function moveMonthFocus(nextMonth: number): void {
    focusedMonth = Math.max(0, Math.min(11, nextMonth));
    rerender();
  }

  function selectMonth(month: number): void {
    const year: number = adapter.getYear(viewMonth);
    if (monthDisabled(year, month)) return;
    const day: number = Math.min(adapter.getDate(focusedDate), adapter.getDaysInMonth(adapter.create(year, month, 1)));
    focusedDate = clampFocus(adapter.create(year, month, day));
    viewMonth = adapter.startOfMonth(focusedDate);
    view = 'day';
    rerender();
  }

  function onMonthKeydown(event: KeyboardEvent): void {
    const key: string = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      host.onEscape();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      selectMonth(focusedMonth);
      return;
    }
    let handled: boolean = true;
    const step: number = activeDirection() === 'rtl' ? -1 : 1;
    if (key === 'ArrowLeft') moveMonthFocus(focusedMonth - step);
    else if (key === 'ArrowRight') moveMonthFocus(focusedMonth + step);
    else if (key === 'ArrowUp') moveMonthFocus(focusedMonth - MONTH_COLS);
    else if (key === 'ArrowDown') moveMonthFocus(focusedMonth + MONTH_COLS);
    else if (key === 'Home') moveMonthFocus(0);
    else if (key === 'End') moveMonthFocus(11);
    else handled = false;
    if (handled) event.preventDefault();
  }

  function yearText(year: number): string {
    return adapter.format(adapter.create(year, 0, 1), { year: 'numeric' });
  }

  function reset(base: Date): void {
    view = 'day';
    viewMonth = adapter.startOfMonth(base);
    focusedDate = base;
    focusedYear = adapter.getYear(base);
    focusedMonth = adapter.getMonth(base);
    rangeStart = focusedYear - mod(focusedYear, YEARS_PER_PAGE);
  }

  return { panel, reset, render, rerender, focusActive };
}
