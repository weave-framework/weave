/**
 * `<Timepicker>` — a time field + spinner popover (the design's h : m + AM/PM columns). A
 * Select-style trigger field (shares Input's chrome via the `field-underline` helper) shows
 * the formatted time + a clock icon; clicking (or ↓/Enter/Space) opens a CDK-overlay panel of
 * **spinbutton columns** — hour ▲/▼, minute ▲/▼ (by `step`), and an AM/PM toggle (12-hour
 * locales). 12h vs 24h is derived from the locale (override with `use24`).
 *
 * - **Value** — a neutral `{ hours, minutes }` (24-hour internally). Binding follows the Weave
 *   form convention: `value` + `onChange`, OR a structural `control` (a forms `Field`).
 * - **Bounds** — `min`/`max` clamp the committed time; `step` (minutes, default 5) sets the
 *   minute increment.
 * - **Keyboard** — each column is a `role=spinbutton`: Arrow Up/Down inc/dec, with
 *   `aria-valuenow`/`-valuetext`. Non-modal popover (click-away + Esc).
 *
 *   import Timepicker from '@weave-framework/ui/timepicker';
 *   <Timepicker control={{ form.controls.start }} step={{ 15 }} />
 */
import { signal, effect, onDispose, type Signal } from '@weave-framework/runtime';
import { createOverlay, connectedPosition, type OverlayRef } from '../cdk/index.js';
import { buildPositions, type MenuPosition } from '../shared/positions.js';

/** A time of day, 24-hour internally. */
export interface TimeValue {
  hours: number;
  minutes: number;
}

/** The subset of a forms `Field<TimeValue>` a Timepicker binds to. */
export interface TimepickerControl {
  value: Signal<TimeValue | null | undefined>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface TimepickerProps {
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: TimeValue | null;
  /** Called with the next value on change/clear. Ignored when `control` is set. */
  onChange?: (value: TimeValue | null) => void;
  /** A forms `Field<TimeValue>` — two-way value + touched-on-close + error state. */
  control?: TimepickerControl;
  /** Earliest selectable time (inclusive). */
  min?: TimeValue;
  /** Latest selectable time (inclusive). */
  max?: TimeValue;
  /** Minute increment. Default 5. */
  step?: number;
  /** Force 24-hour display (else derived from the locale). */
  use24?: boolean;
  /** Locale for the display format + 12/24h default. */
  locale?: string;
  /** Shown when nothing is selected. */
  placeholder?: string;
  /** Disable the control. */
  disabled?: boolean;
  /** Mark required (aria). */
  required?: boolean;
  /** Show a clear (`×`) button when a time is set. */
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
  '<div class="weave-timepicker__field" ref={{ trigger }} role="combobox" tabindex={{ tabindex() }}' +
  ' aria-haspopup="dialog" aria-expanded="false" aria-label={{ label() }} aria-required={{ ariaRequired() }}' +
  ' aria-disabled={{ ariaDisabled() }} on:click={{ onFieldClick }} on:keydown={{ onTriggerKeydown }}>' +
  '<span class={{ valueClass() }}>{{ displayText() }}</span>' +
  '<span class="weave-timepicker__spacer"></span>' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-timepicker__clear" tabindex="-1" aria-label={{ clearLabel() }} on:click={{ onClearClick }}>×</button>' +
  '}' +
  '<span class="weave-timepicker__icon" aria-hidden="true"></span>' +
  '</div>' +
  '</div>';

export interface TimepickerContext {
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

const mm = (t: TimeValue): number => t.hours * 60 + t.minutes;

/** A built spinner column + its value node (updated in renderPanel). */
interface SpinColumn {
  col: HTMLElement;
  value: HTMLElement;
}

let _seq: number = 0;

export function setup(props: TimepickerProps): TimepickerContext {
  const id: number = ++_seq;
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const trigger: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const open: Signal<boolean> = signal<boolean>(false);
  const step: number = props.step ?? 5;

  const resolved: Intl.ResolvedDateTimeFormatOptions = new Intl.DateTimeFormat(props.locale, { hour: 'numeric' }).resolvedOptions();
  const use24: boolean = props.use24 ?? !resolved.hour12;

  let overlay: OverlayRef | null = null;
  let panel: HTMLElement | null = null;
  let hourValueEl: HTMLElement | null = null;
  let minuteValueEl: HTMLElement | null = null;
  let hourCol: HTMLElement | null = null;
  let minuteCol: HTMLElement | null = null;
  let ampmButton: HTMLButtonElement | null = null;
  let seed: TimeValue = { hours: 12, minutes: 0 };

  const isDisabled = (): boolean => !!props.disabled;
  const rawValue = (): TimeValue | null => {
    const v: TimeValue | null | undefined = props.control ? props.control.value() : props.value;
    return v ?? null;
  };
  const workingTime = (): TimeValue => rawValue() ?? seed;

  const clampTime = (t: TimeValue): TimeValue => {
    if (props.min && mm(t) < mm(props.min)) return { ...props.min };
    if (props.max && mm(t) > mm(props.max)) return { ...props.max };
    return t;
  };
  const commit = (next: TimeValue | null): void => {
    const v: TimeValue | null = next ? clampTime(next) : null;
    if (props.control) props.control.value.set(v);
    else props.onChange?.(v);
  };

  const displayHour = (t: TimeValue): number => (use24 ? t.hours : (t.hours % 12) || 12);
  const ampm = (t: TimeValue): 'AM' | 'PM' => (t.hours < 12 ? 'AM' : 'PM');
  const to24 = (dh: number, ap: 'AM' | 'PM'): number => (dh % 12) + (ap === 'PM' ? 12 : 0);

  const formatTime = (t: TimeValue): string => {
    const d: Date = new Date(2000, 0, 1, t.hours, t.minutes);
    return new Intl.DateTimeFormat(props.locale, { hour: 'numeric', minute: '2-digit', hour12: !use24 }).format(d);
  };
  const two = (n: number): string => String(n).padStart(2, '0');

  /* ── spinner operations ── */
  const setTime = (next: TimeValue): void => commit(next);
  const incHour = (): void => {
    const t: TimeValue = workingTime();
    if (use24) setTime({ hours: (t.hours + 1) % 24, minutes: t.minutes });
    else setTime({ hours: to24((displayHour(t) % 12) + 1, ampm(t)), minutes: t.minutes });
  };
  const decHour = (): void => {
    const t: TimeValue = workingTime();
    if (use24) setTime({ hours: (t.hours + 23) % 24, minutes: t.minutes });
    else setTime({ hours: to24(((displayHour(t) + 10) % 12) + 1, ampm(t)), minutes: t.minutes });
  };
  const incMinute = (): void => {
    const t: TimeValue = workingTime();
    setTime({ hours: t.hours, minutes: (Math.floor(t.minutes / step) * step + step) % 60 });
  };
  const decMinute = (): void => {
    const t: TimeValue = workingTime();
    setTime({ hours: t.hours, minutes: (Math.ceil(t.minutes / step) * step - step + 60) % 60 });
  };
  const toggleAmPm = (): void => {
    const t: TimeValue = workingTime();
    setTime({ hours: (t.hours + 12) % 24, minutes: t.minutes });
  };

  /* ── panel ── */
  function spinButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.className = 'weave-timepicker__spin';
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }

  function buildColumn(kind: 'hour' | 'minute', inc: () => void, dec: () => void): SpinColumn {
    const col: HTMLElement = document.createElement('div');
    col.className = 'weave-timepicker__col';
    col.setAttribute('role', 'spinbutton');
    col.tabIndex = 0;
    col.setAttribute('aria-label', kind === 'hour' ? 'Hour' : 'Minute');
    // APG spinbutton requires the value bounds. Hour range depends on 12/24h; minute is 0–59.
    if (kind === 'hour') {
      col.setAttribute('aria-valuemin', use24 ? '0' : '1');
      col.setAttribute('aria-valuemax', use24 ? '23' : '12');
    } else {
      col.setAttribute('aria-valuemin', '0');
      col.setAttribute('aria-valuemax', '59');
    }
    const up: HTMLButtonElement = spinButton('▲', `Increment ${kind}`, inc);
    const value: HTMLElement = document.createElement('span');
    value.className = 'weave-timepicker__col-value';
    const down: HTMLButtonElement = spinButton('▼', `Decrement ${kind}`, dec);
    col.append(up, value, down);
    col.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        inc();
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        dec();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        closePanel(true);
      }
    });
    return { col, value };
  }

  function buildPanel(): HTMLElement {
    const box: HTMLElement = document.createElement('div');
    box.className = 'weave-timepicker__panel';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', 'Choose time');
    box.id = `weave-timepicker-${id}-panel`;

    const hour: SpinColumn = buildColumn('hour', incHour, decHour);
    hourCol = hour.col;
    hourValueEl = hour.value;
    const colon: HTMLElement = document.createElement('span');
    colon.className = 'weave-timepicker__colon';
    colon.textContent = ':';
    colon.setAttribute('aria-hidden', 'true');
    const minute: SpinColumn = buildColumn('minute', incMinute, decMinute);
    minuteCol = minute.col;
    minuteValueEl = minute.value;
    box.append(hourCol, colon, minuteCol);

    if (!use24) {
      ampmButton = document.createElement('button');
      ampmButton.type = 'button';
      ampmButton.className = 'weave-timepicker__ampm';
      ampmButton.addEventListener('click', toggleAmPm);
      box.append(ampmButton);
    }
    return box;
  }

  function renderPanel(): void {
    const t: TimeValue = workingTime();
    if (hourValueEl) hourValueEl.textContent = use24 ? two(displayHour(t)) : String(displayHour(t));
    if (minuteValueEl) minuteValueEl.textContent = two(t.minutes);
    if (hourCol) {
      hourCol.setAttribute('aria-valuenow', String(displayHour(t)));
      hourCol.setAttribute('aria-valuetext', `${displayHour(t)} hours`);
    }
    if (minuteCol) {
      minuteCol.setAttribute('aria-valuenow', String(t.minutes));
      minuteCol.setAttribute('aria-valuetext', `${t.minutes} minutes`);
    }
    if (ampmButton) {
      ampmButton.textContent = ampm(t);
      ampmButton.setAttribute('aria-label', `Toggle AM/PM (currently ${ampm(t)})`);
    }
  }

  function nowSeed(): TimeValue {
    const n: Date = new Date();
    return clampTime({ hours: n.getHours(), minutes: Math.round(n.getMinutes() / step) * step % 60 });
  }

  function openPanel(): void {
    if (open() || isDisabled()) return;
    const t: HTMLElement = trigger() as HTMLElement;
    seed = rawValue() ?? nowSeed();
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
    renderPanel();
    hourCol?.focus();
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

  // Re-render the open panel when the value changes (spinner ops commit → value → here).
  effect(() => {
    rawValue();
    if (open()) renderPanel();
  });
  effect(() => {
    const t: HTMLElement | null = trigger();
    if (!t) return;
    const c: TimepickerControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) t.setAttribute('aria-invalid', 'true');
    else t.removeAttribute('aria-invalid');
  });

  onDispose(() => {
    overlay?.dispose();
    overlay = null;
  });

  const invalidNow = (): boolean => {
    const c: TimepickerControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  return {
    root,
    trigger,
    rootClass: (): string => {
      const parts: string[] = ['weave-timepicker'];
      if (isDisabled()) parts.push('weave-timepicker--disabled');
      if (invalidNow()) parts.push('weave-timepicker--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    valueClass: (): string =>
      rawValue() == null ? 'weave-timepicker__value weave-timepicker__value--placeholder' : 'weave-timepicker__value',
    displayText: (): string => {
      const v: TimeValue | null = rawValue();
      return v ? formatTime(v) : props.placeholder ?? '';
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
