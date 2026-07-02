/**
 * `<Datepicker>` — a date field + calendar popover (WAI-ARIA dialog-grid pattern). A trigger
 * field (the Select-style underline field, sharing Input's chrome via the `field-underline`
 * helper) shows the formatted value + a calendar icon; clicking (or ↓/Enter/Space) opens a
 * CDK-overlay **calendar** — a `role=grid` month view with ‹/› month nav, a locale weekday
 * header, and a full-keyboard day grid. All date math flows through the zero-dep CDK
 * **Date adapter**; the value is a plain local-midnight `Date`.
 *
 * - **Binding** — the Weave form-control convention: `value` (a `Date | null` getter) +
 *   `onChange`, OR a structural `control` (a forms `Field<Date>`). Compose with `<FormField>`
 *   for label/hint/error.
 * - **Bounds** — `min`/`max` + a `dateFilter` predicate disable out-of-range / excluded days.
 * - **Keyboard** — Arrows (day), PageUp/Down (month), Shift+PageUp/Down (year), Home/End
 *   (week edges), Enter/Space (select), Esc (close). Non-modal popover (click-away + Esc).
 *
 *   import Datepicker from '@weave-framework/ui/datepicker';
 *   <Datepicker control={{ form.controls.dob }} max={{ adapter.today() }} />
 */
import { signal, effect, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, createDateAdapter, type OverlayRef, type DateAdapter } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** The subset of a forms `Field<Date>` a Datepicker binds to. */
export interface DatepickerControl {
  value: Signal<Date | null | undefined>;
  touched?: Signal<boolean>;
  error?: () => string | null;
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
  /** Locale for the default adapter (format/parse/first-day/names). */
  locale?: string;
  /** `Intl` options for the field's display format. Default `{ dateStyle: 'medium' }`. */
  displayFormat?: Intl.DateTimeFormatOptions;
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
  /** Accessible name for the clear button. Default 'Clear'. */
  clearLabel?: string;
  /** Panel position relative to the field. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<div class="weave-datepicker__field" ref={{ trigger }} role="combobox" tabindex={{ tabindex() }}' +
  ' aria-haspopup="dialog" aria-expanded="false" aria-label={{ label() }} aria-required={{ ariaRequired() }}' +
  ' aria-disabled={{ ariaDisabled() }} on:click={{ onFieldClick }} on:keydown={{ onTriggerKeydown }}>' +
  '<span class={{ valueClass() }}>{{ displayText() }}</span>' +
  '<span class="weave-datepicker__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-datepicker__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}>×</button>' +
  '}' +
  '<span class="weave-datepicker__icon" aria-hidden="true"></span>' +
  '</div>' +
  '</div>';

export interface DatepickerContext {
  root: Signal<HTMLElement | null>;
  trigger: Signal<HTMLElement | null>;
  rootClass: () => string;
  valueClass: () => string;
  displayText: () => string;
  tabindex: () => number;
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

export function setup(props: DatepickerProps): DatepickerContext {
  const id: number = ++_seq;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const adapter: DateAdapter = props.adapter ?? createDateAdapter({ locale: props.locale });

  let overlay: OverlayRef | null = null;
  let panel: HTMLElement | null = null;
  let headerLabel: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let viewMonth: Date = adapter.startOfMonth(adapter.today());
  let focusedDate: Date = adapter.today();

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

  const clampFocus = (date: Date): Date => adapter.clamp(date, props.min, props.max);

  /* ── the calendar panel (built imperatively; re-rendered on nav) ── */
  function buildPanel(): HTMLElement {
    const box: HTMLElement = document.createElement('div');
    box.className = 'weave-datepicker__panel';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', 'Choose date');
    box.id = `weave-datepicker-${id}-panel`;

    const header: HTMLElement = document.createElement('div');
    header.className = 'weave-datepicker__nav';
    const prev: HTMLButtonElement = navButton('‹', 'Previous month', () => shiftMonth(-1));
    const next: HTMLButtonElement = navButton('›', 'Next month', () => shiftMonth(1));
    headerLabel = document.createElement('span');
    headerLabel.className = 'weave-datepicker__month-label';
    headerLabel.setAttribute('aria-live', 'polite');
    header.append(prev, headerLabel, next);

    const weekdays: HTMLElement = document.createElement('div');
    weekdays.className = 'weave-datepicker__weekdays';
    const first: number = adapter.firstDayOfWeek();
    const names: string[] = adapter.getDayOfWeekNames('narrow');
    for (let i: number = 0; i < 7; i++) {
      const cell: HTMLElement = document.createElement('span');
      cell.className = 'weave-datepicker__weekday';
      cell.textContent = names[(first + i) % 7];
      weekdays.appendChild(cell);
    }

    grid = document.createElement('div');
    grid.className = 'weave-datepicker__grid';
    grid.setAttribute('role', 'grid');
    grid.addEventListener('keydown', onGridKeydown);

    box.append(header, weekdays, grid);
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

  function renderGrid(): void {
    if (!grid || !headerLabel) return;
    headerLabel.textContent = adapter.format(viewMonth, { month: 'long', year: 'numeric' });
    grid.textContent = '';

    const selected: Date | null = rawValue();
    const today: Date = adapter.today();
    const first: number = adapter.firstDayOfWeek();
    const monthStart: Date = adapter.startOfMonth(viewMonth);
    const startWeekday: number = adapter.getDayOfWeek(monthStart);
    const lead: number = (startWeekday - first + 7) % 7;
    const days: number = adapter.getDaysInMonth(viewMonth);
    const total: number = Math.ceil((lead + days) / 7) * 7;

    let row: HTMLElement = newRow();
    for (let cell: number = 0; cell < total; cell++) {
      if (cell > 0 && cell % 7 === 0) {
        grid.appendChild(row);
        row = newRow();
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

  function newRow(): HTMLElement {
    const r: HTMLElement = document.createElement('div');
    r.className = 'weave-datepicker__row';
    r.setAttribute('role', 'row');
    return r;
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

  function focusFocusedCell(): void {
    grid?.querySelector<HTMLElement>('[data-focused="true"]')?.focus();
  }

  function moveFocus(next: Date): void {
    focusedDate = clampFocus(next);
    if (!adapter.isSameDay(adapter.startOfMonth(focusedDate), viewMonth)) {
      viewMonth = adapter.startOfMonth(focusedDate);
    }
    renderGrid();
    focusFocusedCell();
  }

  function shiftMonth(delta: number): void {
    focusedDate = clampFocus(adapter.addMonths(focusedDate, delta));
    viewMonth = adapter.startOfMonth(focusedDate);
    renderGrid();
    focusFocusedCell();
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
    if (key === 'ArrowLeft') moveFocus(adapter.addDays(focusedDate, -1));
    else if (key === 'ArrowRight') moveFocus(adapter.addDays(focusedDate, 1));
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
    const first: number = adapter.firstDayOfWeek();
    const offset: number = (adapter.getDayOfWeek(date) - first + 7) % 7;
    return adapter.addDays(date, -offset);
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    const t: HTMLElement = trigger() as HTMLElement;
    const sel: Date | null = rawValue();
    const base: Date = clampFocus(sel ?? adapter.today());
    viewMonth = adapter.startOfMonth(base);
    focusedDate = base;
    if (!panel) panel = buildPanel();
    overlay = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(t, { positions: buildPositions(props.position, 'bottom-start'), offset: 4 }),
    });
    overlay.onBackdropClick(() => closePanel(false));
    overlay.attach(panel);
    t.setAttribute('aria-expanded', 'true');
    open.set(true);
    renderGrid();
    focusFocusedCell();
  }

  function closePanel(returnFocus: boolean): void {
    if (!open()) return;
    overlay?.detach();
    overlay = null;
    trigger()?.setAttribute('aria-expanded', 'false');
    open.set(false);
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

  // Re-render an open calendar when the external value changes (control/value).
  effect(() => {
    rawValue();
    if (open()) renderGrid();
  });
  // Reflect forms validity on the trigger.
  effect(() => {
    const t: HTMLElement | null = trigger();
    if (!t) return;
    const c: DatepickerControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) t.setAttribute('aria-invalid', 'true');
    else t.removeAttribute('aria-invalid');
  });

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  const invalidNow = (): boolean => {
    const c: DatepickerControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  return {
    root,
    trigger,
    rootClass: (): string => {
      const parts: string[] = ['weave-datepicker'];
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
      return adapter.format(v, props.displayFormat ?? { dateStyle: 'medium' });
    },
    tabindex: (): number => (isDisabled() ? -1 : 0),
    label: (): string | undefined => props.label,
    ariaRequired: (): 'true' | undefined => (props.required ? 'true' : undefined),
    ariaDisabled: (): 'true' | undefined => (isDisabled() ? 'true' : undefined),
    showClear: (): boolean => !!props.clearable && !isDisabled() && rawValue() != null,
    clearLabel: (): string => props.clearLabel ?? 'Clear',
    onFieldClick,
    onTriggerKeydown,
    onClearClick,
  };
}
