/**
 * App-wide defaults for the date/time pickers (FW-19).
 *
 * `<Datepicker>`, `<DateRangePicker>` and `<Timepicker>` are configured per instance — adapter,
 * locale, first day of week, display format, translated chrome, 12/24h, minute step. Every one of
 * those is an **application** decision, not a field one: a picker that does not carry all of them
 * shows a date in a format that appears nowhere else in the app, or English chrome inside a
 * translated UI. Supplying the full set at every call site is what forces an app to wrap each
 * picker in a component that holds nothing but configuration.
 *
 * So provide them once, at the app root:
 *
 *   provideDateTimeDefaults({
 *     locale: () => locale(),                       // getters, so a setting change flows through
 *     firstDayOfWeek: () => weekStartIndex(),
 *     datepickerLabels: () => ({ prevMonth: t('datepicker.prevMonth'), … }),
 *     timepicker: () => ({ use24: timeFormat() === '24h', step: timeStep() }),
 *   });
 *
 * Resolution order is always **instance prop → context default → the component's built-in**, so an
 * app that provides nothing behaves exactly as before, and a single field can still opt out of any
 * one default. Labels merge shallowly at each step: passing three of eight keys never blanks the
 * other five.
 *
 * Rides the owner tree via `provide`/`inject`, so the provider is any ancestor scope (normally the
 * root component's `setup`) and pickers read it wherever they are mounted.
 */
import { createContext, provide, inject, type Context } from '@weave-framework/runtime';
import type { DateAdapter } from './cdk/index.js';
import type { CalendarLabels } from './shared/calendar-view.js';

/**
 * A default that is either a plain value or a **getter**. A getter is what keeps the pickers
 * reactive: it is read inside the component's own reactive scope, so a language or settings change
 * re-renders the field. A plain value is accepted and simply never changes.
 */
export type Defaulted<T> = T | (() => T);

/**
 * Chrome strings shared by the two date pickers: the calendar's own labels plus the field buttons.
 * A superset of both components' label types — `<DateRangePicker>` has no open-calendar button and
 * ignores that key.
 */
export interface DatepickerLabelDefaults extends Partial<CalendarLabels> {
  /** The clear (`×`) button's accessible name. */
  clear?: string;
  /** The open-calendar icon button's accessible name (`<Datepicker editable>` only). */
  openCalendar?: string;
}

/** `<Timepicker>`-only defaults — the rest (locale) is shared with the date pickers. */
export interface TimepickerDefaults {
  /** 24-hour clock. Unset → derived from the locale, as today. */
  use24?: boolean;
  /** Minute granularity. Unset → 5. */
  step?: number;
  /** The clear (`×`) button's accessible name. Unset → `'Clear'`. */
  clearLabel?: string;
}

/** What {@link provideDateTimeDefaults} takes. Every field is optional and may be a getter. */
export interface DateTimeDefaults {
  /** A ready-made adapter for the date pickers. Wins over `locale` (which only builds one). */
  adapter?: Defaulted<DateAdapter>;
  /** Locale for the default date adapter and for the timepicker's hour format. */
  locale?: Defaulted<string>;
  /** First day of the week: `0` Sunday … `6` Saturday. Unset → Monday, as today. */
  firstDayOfWeek?: Defaulted<number>;
  /** `Intl` options for the date field's display format. Unset → `{ dateStyle: 'medium' }`. */
  displayFormat?: Defaulted<Intl.DateTimeFormatOptions>;
  /** Translated chrome for both date pickers. Merged over the English defaults, under the prop. */
  datepickerLabels?: Defaulted<DatepickerLabelDefaults>;
  /** `<Timepicker>`-only defaults. */
  timepicker?: Defaulted<TimepickerDefaults>;
}

/** Nothing provided — every component keeps its own built-in default. */
const NONE: DateTimeDefaults = {};

const DATE_TIME_DEFAULTS: Context<DateTimeDefaults> = createContext<DateTimeDefaults>(NONE);

/**
 * Provide app-wide picker defaults for this owner scope and everything under it. Call once in the
 * root component's `setup`.
 */
export function provideDateTimeDefaults(defaults: DateTimeDefaults): void {
  provide(DATE_TIME_DEFAULTS, defaults);
}

/**
 * The nearest provided defaults, or an empty set. Internal — the pickers call this in `setup`; the
 * returned object is read lazily so getters stay reactive at each use.
 */
export function injectDateTimeDefaults(): DateTimeDefaults {
  return inject(DATE_TIME_DEFAULTS) ?? NONE;
}

/**
 * Unwrap a value-or-getter. Called at each use rather than once at setup, so a getter is read
 * inside whatever reactive scope is asking — that is what makes the defaults live.
 *
 * No `Defaulted<T>` in this API has a function `T`, so `typeof === 'function'` is an unambiguous
 * test for "this is the getter form".
 */
export function readDefault<T>(value: Defaulted<T> | undefined): T | undefined {
  return typeof value === 'function' ? (value as () => T)() : value;
}
