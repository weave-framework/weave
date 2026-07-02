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
  /** Accessible name for the clear button. Default 'Clear'. */
  clearLabel?: string;
  /** Panel position relative to the field. Default `'bottom-start'`. */
  position?: MenuPosition;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<div class="weave-datepicker__field" ref={{ trigger }} role={{ fieldRole() }} tabindex={{ tabindex() }}' +
  ' aria-haspopup={{ fieldHaspopup() }} aria-expanded={{ fieldExpanded() }} aria-label={{ fieldLabel() }}' +
  ' aria-required={{ ariaRequired() }} aria-disabled={{ ariaDisabled() }} on:click={{ onFieldClick }}' +
  ' on:keydown={{ onTriggerKeydown }}>' +
  '@if (editable()) {' +
  '<input class="weave-datepicker__input" ref={{ input }} type="text" role="combobox" aria-haspopup="dialog"' +
  '  aria-expanded={{ inputExpanded() }} aria-label={{ label() }} placeholder={{ placeholder() }} .disabled={{ isDisabled() }}' +
  '  on:keydown={{ onInputKeydown }} on:blur={{ onInputBlur }} on:click={{ onInputClick }} />' +
  '}' +
  '@if (!editable()) {<span class={{ valueClass() }}>{{ displayText() }}</span>}' +
  '<span class="weave-datepicker__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-datepicker__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}>×</button>' +
  '}' +
  '@if (editable()) {<button type="button" class="weave-datepicker__icon-button" tabindex="-1" aria-label="Open calendar" on:click={{ onIconClick }}><span class="weave-datepicker__icon" aria-hidden="true"></span></button>}' +
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
  inputExpanded: () => 'true' | 'false';
  fieldLabel: () => string | undefined;
  tabindex: () => number;
  isDisabled: () => boolean;
  label: () => string | undefined;
  placeholder: () => string | undefined;
  ariaRequired: () => 'true' | undefined;
  ariaDisabled: () => 'true' | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
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
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const input: Signal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const editable = (): boolean => !!props.editable;
  const parseError: Signal<boolean> = signal<boolean>(false);
  const adapter: DateAdapter = props.adapter ?? createDateAdapter({ locale: props.locale });
  // The element carrying combobox `aria-expanded` (the input in editable mode, else the field).
  const comboEl = (): HTMLElement | null => (editable() ? input() : trigger());

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
    open.set(true); // aria-expanded on the combobox is a reactive binding
    renderGrid();
    focusFocusedCell();
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

  // Re-render an open calendar when the external value changes (control/value).
  effect(() => {
    rawValue();
    if (open()) renderGrid();
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
    inputExpanded: (): 'true' | 'false' => (open() ? 'true' : 'false'),
    fieldLabel: (): string | undefined => (editable() ? undefined : props.label),
    tabindex: (): number => (editable() || isDisabled() ? -1 : 0),
    isDisabled,
    label: (): string | undefined => props.label,
    placeholder: (): string | undefined => props.placeholder,
    ariaRequired: (): 'true' | undefined => (props.required ? 'true' : undefined),
    ariaDisabled: (): 'true' | undefined => (isDisabled() ? 'true' : undefined),
    showClear: (): boolean => !!props.clearable && !isDisabled() && rawValue() != null,
    clearLabel: (): string => props.clearLabel ?? 'Clear',
    onFieldClick,
    onTriggerKeydown,
    onInputKeydown,
    onInputBlur,
    onInputClick,
    onIconClick,
    onClearClick,
  };
}
