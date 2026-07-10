/**
 * `<Datepicker>` — a date field + calendar popover (WAI-ARIA dialog-grid pattern). A trigger
 * field (the Select-style underline field, sharing Input's chrome via the `field-underline`
 * helper) shows the formatted value + a calendar icon; clicking (or ↓/Enter/Space) opens a
 * CDK-overlay calendar. The popover is **three drill-down views in one panel**: a `role=grid`
 * **day** view, a **year** grid (pages of 24, ‹/› jump a page), and a **month** grid (Jan–Dec).
 * Clicking the day view's "Month Year" header opens the year grid → pick a year → month grid →
 * pick a month → back to the day grid. All date math flows through the zero-dep CDK **Date
 * adapter**; the value is a plain local-midnight `Date`.
 *
 * - **Binding** — the Weave form-control convention: `value` (a `Date | null` getter) +
 *   `onChange`, OR a structural `control` (a forms `Field<Date>`). Compose with `<FormField>`
 *   for label/hint/error.
 * - **Bounds** — `min`/`max` + a `dateFilter` predicate disable out-of-range / excluded days
 *   (years/months fully outside `min`/`max` are disabled in their grids too).
 * - **First day of week** — `firstDayOfWeek` (0=Sun … 6=Sat). Default **Monday** (1), not the
 *   locale's — override per instance. Month/weekday/year text stays locale-driven (Intl).
 * - **i18n** — pass translated chrome strings via `labels` (a partial object); everything has
 *   an English default. The props are reactive, so `labels` can carry `t('…')` from your i18n.
 * - **Keyboard** — Arrows move within the active grid, PageUp/Down jump a page (day: month;
 *   year: 24-year page), Home/End (row/range edges), Enter/Space (select), Esc (close).
 *
 *   import Datepicker from '@weave-framework/ui/datepicker';
 *   <Datepicker control={{ form.controls.dob }} max={{ adapter.today() }} firstDayOfWeek={{ 1 }} />
 */
import { signal, effect, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, createDateAdapter, activeDirection, type OverlayRef, type DateAdapter } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** The subset of a forms `Field<Date>` a Datepicker binds to. */
export interface DatepickerControl {
  value: Signal<Date | null | undefined>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

/**
 * Translatable chrome strings for the calendar popover — the accessible names of the nav
 * buttons and the view-switch header, the dialog name, the clear button, and the open-calendar
 * button (editable mode). Pass any subset via {@link DatepickerProps.labels}; the rest fall back
 * to these English defaults. Month / weekday / year *text* is not here — it comes from the
 * adapter's `locale` (Intl). Every value may be a `t('…')` result (props are reactive).
 */
export interface DatepickerLabels {
  /** ‹ in the day view — step to the previous month. Default `'Previous month'`. */
  prevMonth: string;
  /** › in the day view — step to the next month. Default `'Next month'`. */
  nextMonth: string;
  /** ‹ in the year view — jump to the previous page of years. Default `'Previous years'`. */
  prevYearRange: string;
  /** › in the year view — jump to the next page of years. Default `'Next years'`. */
  nextYearRange: string;
  /** Accessible name of the header button that opens the year grid (day + month views). Default `'Choose year'`. */
  chooseYear: string;
  /** The dialog's accessible name. Default `'Choose date'`. */
  calendarLabel: string;
  /** The clear (`×`) button's accessible name. Default `'Clear'`. */
  clear: string;
  /** The open-calendar icon button's accessible name (editable mode). Default `'Open calendar'`. */
  openCalendar: string;
}

export interface DatepickerProps {
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: Date | null;
  /** Called with the next value on selection/clear. Ignored when `control` is set. */
  onChange?: (value: Date | null) => void;
  /** A forms `Field<Date>` — two-way value + touched-on-close + error state. */
  control?: DatepickerControl;
  /** Earliest selectable date (inclusive). */
  min?: Date;
  /** Latest selectable date (inclusive). */
  max?: Date;
  /** Return false to disable a specific date. */
  dateFilter?: (date: Date) => boolean;
  /** Bring your own date adapter (else one is created from `locale`). */
  adapter?: DateAdapter;
  /** Locale for the default adapter (format/parse/names). */
  locale?: string;
  /**
   * First day of the week: `0` Sunday … `6` Saturday. Default **`1` (Monday)** — a deliberate
   * component default, independent of the locale — override per instance (e.g. `0` for Sunday-first).
   */
  firstDayOfWeek?: number;
  /** Translated chrome strings (a partial object; unset keys use the English default). */
  labels?: Partial<DatepickerLabels>;
  /** `Intl` options for the field's display format. Default `{ dateStyle: 'medium' }`. */
  displayFormat?: Intl.DateTimeFormatOptions;
  /** Let the user type a date into the field (parsed via the adapter). Default false — the
   *  design's field is a button trigger; `editable` swaps in a typeable input-as-combobox. */
  editable?: boolean;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Disable the control. */
  disabled?: boolean;
  /** Mark required (aria). */
  required?: boolean;
  /** Show a clear (`×`) button when a date is set. */
  clearable?: boolean;
  /** Accessible name (when not wrapped by a FormField label). */
  label?: string;
  /** Accessible name for the clear button. Superseded by `labels.clear`. Default 'Clear'. */
  clearLabel?: string;
  /** Panel position relative to the field. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<div class="weave-datepicker__field" ref={{ trigger }} role={{ fieldRole() }} tabindex={{ tabindex() }}' +
  ' aria-haspopup={{ fieldHaspopup() }} aria-expanded={{ fieldExpanded() }} aria-controls={{ fieldControls() }}' +
  ' aria-label={{ fieldLabel() }}' +
  ' aria-required={{ ariaRequired() }} aria-disabled={{ ariaDisabled() }} on:click={{ onFieldClick }}' +
  ' on:keydown={{ onTriggerKeydown }}>' +
  '@if (editable()) {' +
  '<input class="weave-datepicker__input" ref={{ input }} type="text" role="combobox" aria-haspopup="dialog"' +
  '  aria-expanded={{ inputExpanded() }} aria-controls={{ inputControls() }} aria-label={{ label() }} placeholder={{ placeholder() }} .disabled={{ isDisabled() }}' +
  '  on:keydown={{ onInputKeydown }} on:blur={{ onInputBlur }} on:click={{ onInputClick }} />' +
  '}' +
  '@if (!editable()) {<span class={{ valueClass() }}>{{ displayText() }}</span>}' +
  '<span class="weave-datepicker__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-datepicker__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}>×</button>' +
  '}' +
  '@if (editable()) {<button type="button" class="weave-datepicker__icon-button" tabindex="-1" aria-label={{ openCalendarLabel() }} on:click={{ onIconClick }}><span class="weave-datepicker__icon" aria-hidden="true"></span></button>}' +
  '@if (!editable()) {<span class="weave-datepicker__icon" aria-hidden="true"></span>}' +
  '</div>' +
  '</div>';

export interface DatepickerContext {
  root: Signal<HTMLElement | null>;
  trigger: Signal<HTMLElement | null>;
  input: Signal<HTMLInputElement | null>;
  rootClass: () => string;
  valueClass: () => string;
  displayText: () => string;
  editable: () => boolean;
  fieldRole: () => string | undefined;
  fieldHaspopup: () => string | undefined;
  fieldExpanded: () => 'true' | 'false' | undefined;
  fieldControls: () => string | undefined;
  inputExpanded: () => 'true' | 'false';
  inputControls: () => string | undefined;
  fieldLabel: () => string | undefined;
  tabindex: () => number;
  isDisabled: () => boolean;
  label: () => string | undefined;
  placeholder: () => string | undefined;
  ariaRequired: () => 'true' | undefined;
  ariaDisabled: () => 'true' | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
  openCalendarLabel: () => string;
  onFieldClick: () => void;
  onTriggerKeydown: (event: KeyboardEvent) => void;
  onInputKeydown: (event: KeyboardEvent) => void;
  onInputBlur: () => void;
  onInputClick: (event: MouseEvent) => void;
  onIconClick: (event: MouseEvent) => void;
  onClearClick: (event: MouseEvent) => void;
}

/** The calendar's drill-down views, coarsest-last. */
type CalendarView = 'day' | 'year' | 'month';

/** Year grid geometry — a page of 24 years, 4 across (fits the ~236px panel). */
const YEARS_PER_PAGE: number = 24;
const YEAR_COLS: number = 4;
/** Month grid — the 12 months, 3 across. */
const MONTH_COLS: number = 3;

let _seq: number = 0;

export function setup(props: DatepickerProps): DatepickerContext {
  const id: number = ++_seq;
  const panelId: string = `weave-datepicker-${id}-panel`;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const input: Signal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const editable = (): boolean => !!props.editable;
  const parseError: Signal<boolean> = signal<boolean>(false);
  const adapter: DateAdapter = props.adapter ?? createDateAdapter({ locale: props.locale });
  // The element carrying combobox `aria-expanded` (the input in editable mode, else the field).
  const comboEl = (): HTMLElement | null => (editable() ? input() : trigger());

  // The English label defaults, overlaid with any provided (reactive) `labels`.
  const labels = (): DatepickerLabels => ({
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    prevYearRange: 'Previous years',
    nextYearRange: 'Next years',
    chooseYear: 'Choose year',
    calendarLabel: 'Choose date',
    clear: 'Clear',
    openCalendar: 'Open calendar',
    ...props.labels,
  });

  // First day of the week: the prop wins, else Monday (1) — a component default, not the locale's.
  const firstDay = (): number => {
    const f: number | undefined = props.firstDayOfWeek;
    return f == null ? 1 : (((f % 7) + 7) % 7);
  };

  let overlay: OverlayRef | null = null;
  let panel: HTMLElement | null = null;
  let content: HTMLElement | null = null; // header + grid container, rebuilt per render
  let view: CalendarView = 'day';
  let viewMonth: Date = adapter.startOfMonth(adapter.today()); // day-view anchor + year/month source
  let focusedDate: Date = adapter.today(); // day-view roving focus
  let focusedYear: number = adapter.getYear(focusedDate); // year-view roving focus
  let focusedMonth: number = adapter.getMonth(focusedDate); // month-view roving focus
  let rangeStart: number = focusedYear - mod(focusedYear, YEARS_PER_PAGE); // first year on the year page

  const isDisabled = (): boolean => !!props.disabled;
  const rawValue = (): Date | null => {
    const v: Date | null | undefined = props.control ? props.control.value() : props.value;
    return v ?? null;
  };
  const commit = (next: Date | null): void => {
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const dateDisabled = (date: Date): boolean =>
    (!!props.min && adapter.compare(date, props.min) < 0) ||
    (!!props.max && adapter.compare(date, props.max) > 0) ||
    (!!props.dateFilter && !props.dateFilter(date));

  // A whole year / month is disabled only when it lies entirely outside min…max (day-level
  // `dateFilter` still applies once you drill into the day grid).
  const yearDisabled = (year: number): boolean =>
    (!!props.min && year < adapter.getYear(props.min)) || (!!props.max && year > adapter.getYear(props.max));
  const monthDisabled = (year: number, month: number): boolean => {
    const start: Date = adapter.create(year, month, 1);
    const end: Date = adapter.create(year, month, adapter.getDaysInMonth(start));
    return (!!props.min && adapter.compare(end, props.min) < 0) || (!!props.max && adapter.compare(start, props.max) > 0);
  };

  const clampFocus = (date: Date): Date => adapter.clamp(date, props.min, props.max);
  const clampYear = (year: number): number => {
    let y: number = year;
    if (props.min) y = Math.max(y, adapter.getYear(props.min));
    if (props.max) y = Math.min(y, adapter.getYear(props.max));
    return y;
  };

  /* ── the calendar panel (built imperatively; re-rendered on nav / view switch) ── */
  function buildPanel(): HTMLElement {
    const box: HTMLElement = document.createElement('div');
    box.className = 'weave-datepicker__panel';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', labels().calendarLabel);
    box.id = panelId;
    content = document.createElement('div');
    content.className = 'weave-datepicker__content';
    box.append(content);
    return box;
  }

  function navButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.className = 'weave-datepicker__nav-button';
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }

  // The header's centre control — a `<button>` that switches to a coarser view (day/month → year),
  // or a plain `<span>` label (year view shows the page's year range).
  function viewSwitch(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.className = 'weave-datepicker__month-label weave-datepicker__view-switch';
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

  /** Render the current view into `content` (no focus side effect — see {@link rerender}). */
  function renderPanel(): void {
    if (!content) return;
    content.textContent = '';
    if (view === 'day') renderDayView();
    else if (view === 'year') renderYearView();
    else renderMonthView();
  }

  /** Re-render then move DOM focus onto the active cell — for nav, view switches, keyboard moves. */
  function rerender(): void {
    renderPanel();
    focusActiveCell();
  }

  function focusActiveCell(): void {
    content?.querySelector<HTMLElement>('[data-focused="true"]')?.focus();
  }

  /* ── day view ── */
  function renderDayView(): void {
    const header: HTMLElement = document.createElement('div');
    header.className = 'weave-datepicker__nav';
    const prev: HTMLButtonElement = navButton('‹', labels().prevMonth, () => shiftMonth(-1));
    const next: HTMLButtonElement = navButton('›', labels().nextMonth, () => shiftMonth(1));
    const label: HTMLButtonElement = viewSwitch(
      adapter.format(viewMonth, { month: 'long', year: 'numeric' }),
      labels().chooseYear,
      openYearView
    );
    header.append(prev, label, next);

    const weekdays: HTMLElement = document.createElement('div');
    weekdays.className = 'weave-datepicker__weekdays';
    const first: number = firstDay();
    const names: string[] = adapter.getDayOfWeekNames('narrow');
    for (let i: number = 0; i < 7; i++) {
      const cell: HTMLElement = document.createElement('span');
      cell.className = 'weave-datepicker__weekday';
      cell.textContent = names[(first + i) % 7];
      weekdays.appendChild(cell);
    }

    const grid: HTMLElement = document.createElement('div');
    grid.className = 'weave-datepicker__grid';
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onGridKeydown);
    fillDayGrid(grid, first);

    content!.append(header, weekdays, grid);
  }

  function fillDayGrid(grid: HTMLElement, first: number): void {
    const selected: Date | null = rawValue();
    const today: Date = adapter.today();
    const monthStart: Date = adapter.startOfMonth(viewMonth);
    const startWeekday: number = adapter.getDayOfWeek(monthStart);
    const lead: number = (startWeekday - first + 7) % 7;
    const days: number = adapter.getDaysInMonth(viewMonth);
    const total: number = Math.ceil((lead + days) / 7) * 7;

    let row: HTMLElement = gridRow('weave-datepicker__row');
    for (let cell: number = 0; cell < total; cell++) {
      if (cell > 0 && cell % 7 === 0) {
        grid.appendChild(row);
        row = gridRow('weave-datepicker__row');
      }
      const dayNum: number = cell - lead + 1;
      if (dayNum < 1 || dayNum > days) {
        const blank: HTMLElement = document.createElement('span');
        blank.className = 'weave-datepicker__cell weave-datepicker__cell--blank';
        blank.setAttribute('role', 'gridcell');
        row.appendChild(blank);
        continue;
      }
      const date: Date = adapter.create(adapter.getYear(viewMonth), adapter.getMonth(viewMonth), dayNum);
      row.appendChild(dayCell(date, selected, today));
    }
    grid.appendChild(row);
  }

  function dayCell(date: Date, selected: Date | null, today: Date): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weave-datepicker__cell';
    btn.setAttribute('role', 'gridcell');
    btn.textContent = String(adapter.getDate(date));
    const disabled: boolean = dateDisabled(date);
    const isSelected: boolean = !!selected && adapter.isSameDay(date, selected);
    const isFocused: boolean = adapter.isSameDay(date, focusedDate);
    if (disabled) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('weave-datepicker__cell--disabled');
    }
    if (isSelected) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add('weave-datepicker__cell--selected');
    }
    if (adapter.isSameDay(date, today)) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add('weave-datepicker__cell--today');
    }
    btn.tabIndex = isFocused ? 0 : -1;
    if (isFocused) btn.setAttribute('data-focused', 'true');
    btn.addEventListener('click', () => selectDate(date));
    return btn;
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

  function selectDate(date: Date): void {
    if (dateDisabled(date)) return;
    commit(adapter.clone(date));
    closePanel(true);
  }

  function onGridKeydown(event: KeyboardEvent): void {
    const key: string = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      closePanel(true);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      selectDate(focusedDate);
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
    const first: number = firstDay();
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
    header.className = 'weave-datepicker__nav';
    const prev: HTMLButtonElement = navButton('‹', labels().prevYearRange, () => shiftYearRange(-1));
    const next: HTMLButtonElement = navButton('›', labels().nextYearRange, () => shiftYearRange(1));
    const endYear: number = rangeStart + YEARS_PER_PAGE - 1;
    const range: HTMLElement = document.createElement('span');
    range.className = 'weave-datepicker__month-label weave-datepicker__range-label';
    range.setAttribute('aria-live', 'polite');
    range.textContent = `${yearText(rangeStart)} – ${yearText(endYear)}`;
    header.append(prev, range, next);

    const grid: HTMLElement = document.createElement('div');
    grid.className = 'weave-datepicker__year-grid';
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onYearKeydown);

    const sel: Date | null = rawValue();
    const selYear: number | null = sel ? adapter.getYear(sel) : null;
    const curYear: number = adapter.getYear(adapter.today());
    let row: HTMLElement = gridRow('weave-datepicker__year-row');
    for (let i: number = 0; i < YEARS_PER_PAGE; i++) {
      if (i > 0 && i % YEAR_COLS === 0) {
        grid.appendChild(row);
        row = gridRow('weave-datepicker__year-row');
      }
      row.appendChild(yearCell(rangeStart + i, selYear, curYear));
    }
    grid.appendChild(row);
    content!.append(header, grid);
  }

  function yearCell(year: number, selYear: number | null, curYear: number): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weave-datepicker__year-cell';
    btn.setAttribute('role', 'gridcell');
    btn.textContent = yearText(year);
    if (yearDisabled(year)) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('weave-datepicker__year-cell--disabled');
    }
    if (selYear === year) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add('weave-datepicker__year-cell--selected');
    }
    if (curYear === year) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add('weave-datepicker__year-cell--today');
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
      closePanel(true);
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
    header.className = 'weave-datepicker__nav weave-datepicker__nav--center';
    const year: number = adapter.getYear(viewMonth);
    const label: HTMLButtonElement = viewSwitch(yearText(year), labels().chooseYear, openYearView);
    header.append(label);

    const grid: HTMLElement = document.createElement('div');
    grid.className = 'weave-datepicker__month-grid';
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onMonthKeydown);

    const names: string[] = adapter.getMonthNames('short');
    const sel: Date | null = rawValue();
    const selMonth: number | null = sel && adapter.getYear(sel) === year ? adapter.getMonth(sel) : null;
    const today: Date = adapter.today();
    const curMonth: number | null = adapter.getYear(today) === year ? adapter.getMonth(today) : null;

    let row: HTMLElement = gridRow('weave-datepicker__month-row');
    for (let m: number = 0; m < 12; m++) {
      if (m > 0 && m % MONTH_COLS === 0) {
        grid.appendChild(row);
        row = gridRow('weave-datepicker__month-row');
      }
      row.appendChild(monthCell(m, names[m], year, selMonth, curMonth));
    }
    grid.appendChild(row);
    content!.append(header, grid);
  }

  function monthCell(month: number, name: string, year: number, selMonth: number | null, curMonth: number | null): HTMLButtonElement {
    const btn: HTMLButtonElement = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weave-datepicker__month-cell';
    btn.setAttribute('role', 'gridcell');
    btn.textContent = name;
    if (monthDisabled(year, month)) {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('weave-datepicker__month-cell--disabled');
    }
    if (selMonth === month) {
      btn.setAttribute('aria-selected', 'true');
      btn.classList.add('weave-datepicker__month-cell--selected');
    }
    if (curMonth === month) {
      btn.setAttribute('aria-current', 'date');
      btn.classList.add('weave-datepicker__month-cell--today');
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
      closePanel(true);
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

  function openPanel(): void {
    if (open() || isDisabled()) return;
    const t: HTMLElement = trigger() as HTMLElement;
    const sel: Date | null = rawValue();
    const base: Date = clampFocus(sel ?? adapter.today());
    view = 'day'; // every open starts on the day grid
    viewMonth = adapter.startOfMonth(base);
    focusedDate = base;
    focusedYear = adapter.getYear(base);
    focusedMonth = adapter.getMonth(base);
    rangeStart = focusedYear - mod(focusedYear, YEARS_PER_PAGE);
    if (!panel) panel = buildPanel();
    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(t, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
    overlay.onBackdropClick(() => closePanel(false));
    overlay.attach(panel);
    open.set(true); // aria-expanded on the combobox is a reactive binding
    rerender();
  }

  function closePanel(returnFocus: boolean): void {
    if (!open()) return;
    overlay?.detach();
    overlay = null;
    open.set(false);
    props.control?.touched?.set(true);
    if (returnFocus) comboEl()?.focus();
  }

  const onFieldClick = (): void => {
    if (editable()) return; // the input focuses for typing; the icon button opens the calendar
    if (open()) closePanel(true);
    else openPanel();
  };

  const onTriggerKeydown = (event: KeyboardEvent): void => {
    if (editable() || isDisabled() || open()) return; // the input owns keys in editable mode
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel();
    }
  };

  const formatValue = (v: Date): string => adapter.format(v, props.displayFormat ?? { dateStyle: 'medium' });

  // Parse the typed text via the adapter: valid → commit (clamped) + normalise the display;
  // empty → clear; unparseable → keep the text + flag a parse error (aria-invalid).
  const parseInput = (): void => {
    const el: HTMLInputElement | null = input();
    if (!el) return;
    const text: string = el.value.trim();
    if (!text) {
      parseError.set(false);
      commit(null);
      return;
    }
    const parsed: Date | null = adapter.parse(text);
    if (parsed) {
      const committed: Date = adapter.clamp(parsed, props.min, props.max);
      parseError.set(false);
      commit(committed);
      el.value = formatValue(committed);
    } else {
      parseError.set(true); // keep the raw text; surface it as invalid
    }
  };

  const onInputKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open()) openPanel();
      return;
    }
    if (event.key === 'Enter') {
      if (open()) return; // the calendar grid owns Enter while focus is inside it
      event.preventDefault();
      parseInput();
      return;
    }
    if (event.key === 'Escape' && open()) {
      event.preventDefault();
      closePanel(true);
    }
  };

  const onInputBlur = (): void => {
    parseInput();
    props.control?.touched?.set(true);
  };
  const onInputClick = (event: MouseEvent): void => {
    event.stopPropagation(); // focus for typing; don't toggle the calendar
  };
  const onIconClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (open()) closePanel(true);
    else openPanel();
  };

  const onClearClick = (event: MouseEvent): void => {
    event.stopPropagation();
    parseError.set(false);
    commit(null);
    const el: HTMLInputElement | null = input();
    if (el) el.value = '';
  };

  // Keep the editable input's text in sync with the value when the user isn't typing.
  effect(() => {
    const v: Date | null = rawValue();
    const el: HTMLInputElement | null = input();
    if (editable() && el && document.activeElement !== el) {
      el.value = v ? formatValue(v) : '';
      parseError.set(false);
    }
  });

  // Re-render an open calendar when the external value changes (control/value). No focus steal —
  // the roving focus only moves on user nav, not on a value write.
  effect(() => {
    rawValue();
    if (open()) renderPanel();
  });
  // Reflect forms validity + a parse error as aria-invalid on the combobox element.
  effect(() => {
    const el: HTMLElement | null = comboEl();
    if (!el) return;
    if (invalidNow()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  function invalidNow(): boolean {
    const c: DatepickerControl | undefined = props.control;
    return parseError() || !!(c && c.touched?.() && c.error?.());
  }

  return {
    root,
    trigger,
    input,
    rootClass: (): string => {
      const parts: string[] = ['weave-datepicker'];
      if (editable()) parts.push('weave-datepicker--editable');
      if (isDisabled()) parts.push('weave-datepicker--disabled');
      if (invalidNow()) parts.push('weave-datepicker--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    valueClass: (): string =>
      rawValue() == null ? 'weave-datepicker__value weave-datepicker__value--placeholder' : 'weave-datepicker__value',
    displayText: (): string => {
      const v: Date | null = rawValue();
      if (!v) return props.placeholder ?? '';
      return formatValue(v);
    },
    editable,
    fieldRole: (): string | undefined => (editable() ? undefined : 'combobox'),
    fieldHaspopup: (): string | undefined => (editable() ? undefined : 'dialog'),
    fieldExpanded: (): 'true' | 'false' | undefined => (editable() ? undefined : open() ? 'true' : 'false'),
    // aria-controls points at the calendar panel only while it is open + in the DOM (APG combobox).
    fieldControls: (): string | undefined => (!editable() && open() ? panelId : undefined),
    inputExpanded: (): 'true' | 'false' => (open() ? 'true' : 'false'),
    inputControls: (): string | undefined => (editable() && open() ? panelId : undefined),
    fieldLabel: (): string | undefined => (editable() ? undefined : props.label),
    tabindex: (): number => (editable() || isDisabled() ? -1 : 0),
    isDisabled,
    label: (): string | undefined => props.label,
    placeholder: (): string | undefined => props.placeholder,
    ariaRequired: (): 'true' | undefined => (props.required ? 'true' : undefined),
    ariaDisabled: (): 'true' | undefined => (isDisabled() ? 'true' : undefined),
    showClear: (): boolean => !!props.clearable && !isDisabled() && rawValue() != null,
    clearLabel: (): string => props.labels?.clear ?? props.clearLabel ?? 'Clear',
    openCalendarLabel: (): string => props.labels?.openCalendar ?? 'Open calendar',
    onFieldClick,
    onTriggerKeydown,
    onInputKeydown,
    onInputBlur,
    onInputClick,
    onIconClick,
    onClearClick,
  };
}

/** Non-negative modulo (JS `%` keeps the sign of the dividend). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
