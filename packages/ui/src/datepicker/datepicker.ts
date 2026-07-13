/**
 * `<Datepicker>` — a date field + calendar popover (WAI-ARIA dialog-grid pattern). A trigger
 * field (the Select-style underline field, sharing Input's chrome via the `field-underline`
 * helper) shows the formatted value + a calendar icon; clicking (or ↓/Enter/Space) opens a
 * CDK-overlay calendar. The popover is **three drill-down views in one panel**: a `role=grid`
 * **day** view, a **year** grid (pages of 24, ‹/› jump a page), and a **month** grid (Jan–Dec).
 * Clicking the day view's "Month Year" header opens the year grid → pick a year → month grid →
 * pick a month → back to the day grid. The three-view calendar engine is the shared
 * {@link createCalendarView} core (also used by `<DateRangePicker>`); all date math flows
 * through the zero-dep CDK **Date adapter**; the value is a plain local-midnight `Date`.
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
import { createOverlay, connectedPosition, createDateAdapter, type OverlayRef, type DateAdapter } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';
import { createCalendarView, CALENDAR_LABEL_DEFAULTS, type CalendarView, type CalendarLabels } from '../shared/calendar-view.js';

/** The subset of a forms `Field<Date>` a Datepicker binds to. */
export interface DatepickerControl {
  value: Signal<Date | null | undefined>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

/**
 * Translatable chrome strings for the calendar popover — the shared calendar chrome
 * ({@link CalendarLabels}) plus the field's clear + open-calendar buttons. Pass any subset via
 * {@link DatepickerProps.labels}; the rest fall back to English defaults. Month / weekday / year
 * *text* is not here — it comes from the adapter's `locale` (Intl). Every value may be a `t('…')`
 * result (props are reactive).
 */
export interface DatepickerLabels extends CalendarLabels {
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
    ...CALENDAR_LABEL_DEFAULTS,
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
  let calendar: CalendarView | null = null;

  const isDisabled = (): boolean => !!props.disabled;
  const rawValue = (): Date | null => {
    const v: Date | null | undefined = props.control ? props.control.value() : props.value;
    return v ?? null;
  };
  const commit = (next: Date | null): void => {
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  function ensureCalendar(): CalendarView {
    if (calendar) return calendar;
    calendar = createCalendarView({
      prefix: 'weave-datepicker',
      panelId,
      adapter,
      labels, // DatepickerLabels is a superset of CalendarLabels
      firstDay,
      min: (): Date | undefined => props.min,
      max: (): Date | undefined => props.max,
      dateFilter: props.dateFilter,
      isSelected: (date: Date): boolean => {
        const v: Date | null = rawValue();
        return !!v && adapter.isSameDay(date, v);
      },
      isYearSelected: (year: number): boolean => {
        const v: Date | null = rawValue();
        return !!v && adapter.getYear(v) === year;
      },
      isMonthSelected: (year: number, month: number): boolean => {
        const v: Date | null = rawValue();
        return !!v && adapter.getYear(v) === year && adapter.getMonth(v) === month;
      },
      onSelectDay: (date: Date): void => {
        commit(date);
        closePanel(true);
      },
      onEscape: (): void => closePanel(true),
    });
    return calendar;
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    const t: HTMLElement = trigger() as HTMLElement;
    const sel: Date | null = rawValue();
    const base: Date = adapter.clamp(sel ?? adapter.today(), props.min, props.max);
    const cal: CalendarView = ensureCalendar();
    cal.reset(base); // every open starts on the day grid, anchored at the value
    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(t, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
    overlay.onBackdropClick(() => closePanel(false));
    overlay.attach(cal.panel);
    open.set(true); // aria-expanded on the combobox is a reactive binding
    cal.rerender();
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
    if (open() && calendar) calendar.render();
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
