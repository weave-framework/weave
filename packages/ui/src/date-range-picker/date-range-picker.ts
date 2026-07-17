/**
 * `<DateRangePicker>` — a date-**range** field + calendar popover. A trigger field (the
 * Datepicker-style underline field) shows the formatted `start – end`; clicking (or ↓/Enter/
 * Space) opens the shared CDK-overlay calendar. The popover is the same three drill-down views
 * as `<Datepicker>` ({@link createCalendarView}): a `role=grid` **day** view, a **year** grid,
 * and a **month** grid — one month at a time; you page ‹/› across the boundary.
 *
 * **Selecting a range** is two clicks: the first sets the range's anchor (accent-filled), the
 * second completes it — the two are ordered automatically (click before the anchor and it
 * becomes the new start). While picking the end, hovering a day previews the span (a tinted
 * band + a dashed ring on the tentative end). The value only commits on the *second* click;
 * closing early keeps the previous value.
 *
 * - **Binding** — the Weave form-control convention: `value` (a `DateRange | null` getter) +
 *   `onChange`, OR a structural `control` (a forms `Field<DateRange>`). Compose with `<FormField>`.
 * - **Bounds** — `min`/`max` + a `dateFilter` predicate disable out-of-range / excluded days.
 * - **First day of week** — `firstDayOfWeek` (0=Sun … 6=Sat). Default **Monday** (1).
 * - **i18n** — translated chrome via `labels` (a partial object); every key has an English
 *   default. Props are reactive, so `labels` can carry `t('…')`. The field's `start`/`end`
 *   separator is `separator` (default `' – '`).
 * - **Keyboard** — Arrows move within the active grid, PageUp/Down jump a page, Home/End, Enter/
 *   Space select, Esc closes.
 *
 *   import DateRangePicker from '@weave-framework/ui/date-range-picker';
 *   <DateRangePicker control={{ form.controls.stay }} min={{ adapter.today() }} clearable={{ true }} />
 */
import { signal, effect, untrack, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, createDateAdapter, type OverlayRef, type DateAdapter } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';
import { createCalendarView, CALENDAR_LABEL_DEFAULTS, type CalendarView, type CalendarLabels } from '../shared/calendar-view.js';

/** A selected date range. A committed value always has both ends; `null` means "no range". */
export interface DateRange {
  start: Date | null;
  end: Date | null;
}

/** The subset of a forms `Field<DateRange>` a DateRangePicker binds to. */
export interface DateRangePickerControl {
  value: Signal<DateRange | null | undefined>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

/**
 * Translatable chrome strings — the shared calendar chrome ({@link CalendarLabels}) plus the
 * field's clear button. Pass any subset via {@link DateRangePickerProps.labels}; the rest fall
 * back to English defaults. Month / weekday / year *text* comes from the adapter's locale (Intl).
 */
export interface DateRangePickerLabels extends CalendarLabels {
  /** The clear (`×`) button's accessible name. Default `'Clear'`. */
  clear: string;
}

export interface DateRangePickerProps {
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: DateRange | null;
  /** Called with the next value on completion/clear. Ignored when `control` is set. */
  onChange?: (value: DateRange | null) => void;
  /** A forms `Field<DateRange>` — two-way value + touched-on-close + error state. */
  control?: DateRangePickerControl;
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
   * component default, independent of the locale.
   */
  firstDayOfWeek?: number;
  /** Translated chrome strings (a partial object; unset keys use the English default). */
  labels?: Partial<DateRangePickerLabels>;
  /** `Intl` options for the field's display format (applied to both ends). Default `{ dateStyle: 'medium' }`. */
  displayFormat?: Intl.DateTimeFormatOptions;
  /** Separator between the two formatted dates in the field. Default `' – '`. */
  separator?: string;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Disable the control. */
  disabled?: boolean;
  /** Mark required (aria). */
  required?: boolean;
  /** Show a clear (`×`) button when a range is set. */
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
  '<div class="weave-date-range-picker__field" ref={{ trigger }} role="combobox" tabindex={{ tabindex() }}' +
  ' aria-haspopup="dialog" aria-expanded={{ fieldExpanded() }} aria-controls={{ fieldControls() }}' +
  ' aria-label={{ label() }} aria-required={{ ariaRequired() }} aria-disabled={{ ariaDisabled() }}' +
  ' on:click={{ onFieldClick }} on:keydown={{ onTriggerKeydown }}>' +
  '<span class={{ valueClass() }}>{{ displayText() }}</span>' +
  '<span class="weave-date-range-picker__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-date-range-picker__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}><Icon name={{ \'x\' }} /></button>' +
  '}' +
  '<span class="weave-date-range-picker__icon" aria-hidden="true"><Icon name={{ \'calendar\' }} /></span>' +
  '</div>' +
  '</div>';

export interface DateRangePickerContext {
  root: Signal<HTMLElement | null>;
  trigger: Signal<HTMLElement | null>;
  rootClass: () => string;
  valueClass: () => string;
  displayText: () => string;
  fieldExpanded: () => 'true' | 'false';
  fieldControls: () => string | undefined;
  tabindex: () => number;
  isDisabled: () => boolean;
  label: () => string | undefined;
  ariaRequired: () => 'true' | undefined;
  ariaDisabled: () => 'true' | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
  onFieldClick: () => void;
  onTriggerKeydown: (event: KeyboardEvent) => void;
  onClearClick: (event: MouseEvent) => void;
}

let _seq: number = 0;

export function setup(props: DateRangePickerProps): DateRangePickerContext {
  const id: number = ++_seq;
  const panelId: string = `weave-date-range-picker-${id}-panel`;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const adapter: DateAdapter = props.adapter ?? createDateAdapter({ locale: props.locale });

  // While picking: the anchor (first click). Null = not mid-selection (field shows the value).
  const pendingStart: Signal<Date | null> = signal<Date | null>(null);
  // The hovered day while picking the end — drives the preview band.
  const hoverDate: Signal<Date | null> = signal<Date | null>(null);

  // The English label defaults, overlaid with any provided (reactive) `labels`.
  const labels = (): DateRangePickerLabels => ({
    ...CALENDAR_LABEL_DEFAULTS,
    calendarLabel: 'Choose date range',
    clear: 'Clear',
    ...props.labels,
  });

  // First day of the week: the prop wins, else Monday (1).
  const firstDay = (): number => {
    const f: number | undefined = props.firstDayOfWeek;
    return f == null ? 1 : (((f % 7) + 7) % 7);
  };

  let overlay: OverlayRef | null = null;
  let calendar: CalendarView | null = null;

  const isDisabled = (): boolean => !!props.disabled;
  const rawValue = (): DateRange | null => {
    const v: DateRange | null | undefined = props.control ? props.control.value() : props.value;
    return v ?? null;
  };
  const commit = (next: DateRange | null): void => {
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const hasValue = (): boolean => {
    const v: DateRange | null = rawValue();
    return !!v && (!!v.start || !!v.end);
  };

  /* ── day decoration: committed range band OR live preview while picking ── */
  const p: string = 'weave-date-range-picker';
  const between = (date: Date, lo: Date, hi: Date): boolean =>
    adapter.compare(date, lo) > 0 && adapter.compare(date, hi) < 0;

  const decorateDay = (date: Date, btn: HTMLButtonElement): void => {
    const anchor: Date | null = pendingStart();
    if (anchor) {
      // Mid-selection: preview from the anchor to the hovered day.
      const hov: Date | null = hoverDate();
      if (!hov) return; // just the anchor's --selected fill, no band yet
      const lo: Date = adapter.compare(hov, anchor) < 0 ? hov : anchor;
      const hi: Date = adapter.compare(hov, anchor) < 0 ? anchor : hov;
      if (adapter.isSameDay(lo, hi)) return; // hovering the anchor itself
      if (between(date, lo, hi)) btn.classList.add(`${p}__cell--preview`);
      if (adapter.isSameDay(date, lo)) btn.classList.add(`${p}__cell--preview-start`);
      if (adapter.isSameDay(date, hi)) btn.classList.add(`${p}__cell--preview-end`);
      if (adapter.isSameDay(date, hov)) btn.classList.add(`${p}__cell--preview-edge`);
      return;
    }
    // Committed range: the in-between band + rounded ends (the ends also carry --selected).
    const v: DateRange | null = rawValue();
    if (!v || !v.start || !v.end) return;
    const s: Date = v.start;
    const e: Date = v.end;
    if (between(date, s, e)) btn.classList.add(`${p}__cell--in-range`);
    if (adapter.isSameDay(date, s)) btn.classList.add(`${p}__cell--range-start`);
    if (adapter.isSameDay(date, e)) btn.classList.add(`${p}__cell--range-end`);
  };

  // Accent-fill endpoints: the anchor while picking, else both committed ends.
  const isSelected = (date: Date): boolean => {
    const anchor: Date | null = pendingStart();
    if (anchor) return adapter.isSameDay(date, anchor);
    const v: DateRange | null = rawValue();
    return !!v && ((!!v.start && adapter.isSameDay(date, v.start)) || (!!v.end && adapter.isSameDay(date, v.end)));
  };

  // The year/month grids mark the anchor's (or committed start's) period.
  const refDate = (): Date | null => pendingStart() ?? rawValue()?.start ?? null;

  const onSelectDay = (date: Date): void => {
    const anchor: Date | null = pendingStart();
    if (!anchor) {
      // First click — start a fresh range at the anchor. Re-decorate in place (same month) so the
      // day cells keep their identity and the *second* click (a real mousedown+mouseup) still fires.
      pendingStart.set(adapter.clone(date));
      hoverDate.set(null);
      calendar?.refreshDays();
      return;
    }
    // Second click — complete, ordering the two ends.
    const start: Date = adapter.compare(date, anchor) < 0 ? adapter.clone(date) : anchor;
    const end: Date = adapter.compare(date, anchor) < 0 ? anchor : adapter.clone(date);
    pendingStart.set(null);
    hoverDate.set(null);
    commit({ start, end });
    closePanel(true);
  };

  function ensureCalendar(): CalendarView {
    if (calendar) return calendar;
    calendar = createCalendarView({
      prefix: p,
      panelId,
      adapter,
      labels, // DateRangePickerLabels is a superset of CalendarLabels
      firstDay,
      min: (): Date | undefined => props.min,
      max: (): Date | undefined => props.max,
      dateFilter: props.dateFilter,
      isSelected,
      isYearSelected: (year: number): boolean => {
        const r: Date | null = refDate();
        return !!r && adapter.getYear(r) === year;
      },
      isMonthSelected: (year: number, month: number): boolean => {
        const r: Date | null = refDate();
        return !!r && adapter.getYear(r) === year && adapter.getMonth(r) === month;
      },
      decorateDay,
      onSelectDay,
      onHoverDay: (date: Date): void => {
        if (!pendingStart()) return; // preview only while picking the end
        hoverDate.set(adapter.clone(date));
        calendar?.refreshDays(); // in-place — never rebuild the grid under the pointer (breaks the click)
      },
      onHoverLeave: (): void => {
        if (!pendingStart() || !hoverDate()) return;
        hoverDate.set(null);
        calendar?.refreshDays();
      },
      onEscape: (): void => closePanel(true),
    });
    return calendar;
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    const t: HTMLElement = trigger() as HTMLElement;
    const v: DateRange | null = rawValue();
    const base: Date = adapter.clamp(v?.start ?? adapter.today(), props.min, props.max);
    pendingStart.set(null); // every open starts a fresh selection
    hoverDate.set(null);
    const cal: CalendarView = ensureCalendar();
    cal.reset(base);
    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(t, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
    overlay.onBackdropClick(() => closePanel(false));
    overlay.attach(cal.panel);
    open.set(true);
    cal.rerender();
  }

  function closePanel(returnFocus: boolean): void {
    if (!open()) return;
    overlay?.detach();
    overlay = null;
    open.set(false);
    pendingStart.set(null); // discard an incomplete selection
    hoverDate.set(null);
    props.control?.touched?.set(true);
    if (returnFocus) trigger()?.focus();
  }

  const onFieldClick = (): void => {
    if (open()) closePanel(true);
    else openPanel();
  };

  const onTriggerKeydown = (event: KeyboardEvent): void => {
    if (isDisabled() || open()) return;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel();
    }
  };

  const onClearClick = (event: MouseEvent): void => {
    event.stopPropagation();
    commit(null);
  };

  const formatValue = (v: Date): string => adapter.format(v, props.displayFormat ?? { dateStyle: 'medium' });

  // Re-render an open calendar when the EXTERNAL value changes. `render()` reads the pending /
  // hover signals (via decorateDay), so it must run untracked — otherwise this effect would also
  // re-run on every hover, rebuilding the grid under the pointer and breaking the click (the whole
  // point of refreshDays). Depend only on the explicit `rawValue()` read above.
  effect(() => {
    rawValue();
    if (open() && calendar) untrack(() => calendar!.render());
  });
  // Reflect forms validity as aria-invalid on the field.
  effect(() => {
    const el: HTMLElement | null = trigger();
    if (!el) return;
    if (invalidNow()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  function invalidNow(): boolean {
    const c: DateRangePickerControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  }

  return {
    root,
    trigger,
    rootClass: (): string => {
      const parts: string[] = ['weave-date-range-picker'];
      if (isDisabled()) parts.push('weave-date-range-picker--disabled');
      if (invalidNow()) parts.push('weave-date-range-picker--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    valueClass: (): string =>
      hasValue() ? 'weave-date-range-picker__value' : 'weave-date-range-picker__value weave-date-range-picker__value--placeholder',
    displayText: (): string => {
      const v: DateRange | null = rawValue();
      if (!v || (!v.start && !v.end)) return props.placeholder ?? '';
      const sep: string = props.separator ?? ' – ';
      const s: string = v.start ? formatValue(v.start) : '';
      const e: string = v.end ? formatValue(v.end) : '';
      if (s && e) return `${s}${sep}${e}`;
      return s || e;
    },
    fieldExpanded: (): 'true' | 'false' => (open() ? 'true' : 'false'),
    fieldControls: (): string | undefined => (open() ? panelId : undefined),
    tabindex: (): number => (isDisabled() ? -1 : 0),
    isDisabled,
    label: (): string | undefined => props.label,
    ariaRequired: (): 'true' | undefined => (props.required ? 'true' : undefined),
    ariaDisabled: (): 'true' | undefined => (isDisabled() ? 'true' : undefined),
    showClear: (): boolean => !!props.clearable && !isDisabled() && hasValue(),
    clearLabel: (): string => props.labels?.clear ?? props.clearLabel ?? 'Clear',
    onFieldClick,
    onTriggerKeydown,
    onClearClick,
  };
}
