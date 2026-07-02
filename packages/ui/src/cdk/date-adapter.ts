/**
 * Date adapter — the zero-dep date model under the Datepicker calendar + the Timepicker.
 * Native `Date` + `Intl` only (rule #1 — no date library, ever). The neutral value type is a
 * plain **local-midnight `Date`** (forms-friendly, comparable); every calendar/picker does its
 * arithmetic through this, never raw date math.
 *
 * Covers: create/clone/today, add days/months/years (overflow-clamped, DST-safe via the Date
 * constructor), start/end of month + days-in-month, day-of-week, compare/same-day, min/max
 * clamp, `Intl` format, locale-aware parse (ISO fast-path + the locale's numeric field order),
 * and the calendar-grid helpers (locale first-day-of-week + weekday/month names).
 *
 *   const adapter = createDateAdapter({ locale: 'lt' });
 *   adapter.format(adapter.today(), { dateStyle: 'medium' });   // "2026 m. liepos 2 d."
 */

/** The headless date model. All dates are local-midnight `Date`s. */
export interface DateAdapter {
  /** Today at local midnight. */
  today(): Date;
  /** A local-midnight date (month is 0-based, JS convention). */
  create(year: number, month: number, day: number): Date;
  /** Copy a date. */
  clone(date: Date): Date;

  getYear(date: Date): number;
  /** 0-based month (0 = January). */
  getMonth(date: Date): number;
  /** Day of the month, 1-31. */
  getDate(date: Date): number;
  /** Day of the week, 0-6 (0 = Sunday, JS convention). */
  getDayOfWeek(date: Date): number;

  addYears(date: Date, years: number): Date;
  addMonths(date: Date, months: number): Date;
  addDays(date: Date, days: number): Date;

  startOfMonth(date: Date): Date;
  endOfMonth(date: Date): Date;
  getDaysInMonth(date: Date): number;

  /** Same calendar day (ignores time). */
  isSameDay(a: Date, b: Date): boolean;
  /** -1 / 0 / 1 by calendar day. */
  compare(a: Date, b: Date): number;
  /** Clamp a date into `[min, max]` (either bound optional). */
  clamp(date: Date, min?: Date | null, max?: Date | null): Date;
  /** A real, non-`Invalid` Date. */
  isValid(date: unknown): date is Date;

  /** Parse user text → a date, or null. ISO `yyyy-mm-dd` fast-path, else the locale's numeric order. */
  parse(value: string): Date | null;
  /** Format via `Intl.DateTimeFormat` (defaults to a medium date). */
  format(date: Date, options?: Intl.DateTimeFormatOptions): string;

  /** Locale-aware first day of the week, 0-6 (0 = Sunday). */
  firstDayOfWeek(): number;
  /** Weekday names in JS order (index 0 = Sunday). */
  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[];
  /** The 12 month names (index 0 = January). */
  getMonthNames(style: 'long' | 'short' | 'narrow'): string[];
}

export interface DateAdapterOptions {
  /** BCP-47 locale for format/parse/names/first-day (default: the runtime default). */
  locale?: string;
  /** Override the locale's first day of the week (0 = Sunday … 6 = Saturday). */
  firstDayOfWeek?: number;
}

// A reference date with month/day/year all distinct and day > 12 — so `formatToParts`
// field detection is unambiguous. (Wed 22 Nov 2017.)
const REF_ORDER: Date = new Date(2017, 10, 22);
// A known Sunday (1 Jan 2017, UTC) to enumerate weekday names in JS order.
const REF_SUNDAY_UTC: number = Date.UTC(2017, 0, 1);

/** Create a native `Date`+`Intl` date adapter. Zero-dep. */
export function createDateAdapter(options: DateAdapterOptions = {}): DateAdapter {
  const locale: string | undefined = options.locale;

  const create = (year: number, month: number, day: number): Date => new Date(year, month, day);
  const getYear = (date: Date): number => date.getFullYear();
  const getMonth = (date: Date): number => date.getMonth();
  const getDate = (date: Date): number => date.getDate();
  const isValid = (date: unknown): date is Date => date instanceof Date && !Number.isNaN(date.getTime());

  const getDaysInMonth = (date: Date): number => new Date(getYear(date), getMonth(date) + 1, 0).getDate();

  const compare = (a: Date, b: Date): number => {
    const da: number = create(getYear(a), getMonth(a), getDate(a)).getTime();
    const db: number = create(getYear(b), getMonth(b), getDate(b)).getTime();
    return da < db ? -1 : da > db ? 1 : 0;
  };

  // The locale's numeric field order (e.g. ['month','day','year'] for en-US), from Intl parts.
  const numericFieldOrder = (): Array<'year' | 'month' | 'day'> => {
    try {
      const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(REF_ORDER);
      const order: Array<'year' | 'month' | 'day'> = [];
      for (const p of parts) if (p.type === 'year' || p.type === 'month' || p.type === 'day') order.push(p.type);
      return order.length === 3 ? order : ['year', 'month', 'day'];
    } catch {
      return ['year', 'month', 'day'];
    }
  };

  const adapter: DateAdapter = {
    today: (): Date => {
      const now: Date = new Date();
      return create(now.getFullYear(), now.getMonth(), now.getDate());
    },
    create,
    clone: (date: Date): Date => new Date(date.getTime()),
    getYear,
    getMonth,
    getDate,
    getDayOfWeek: (date: Date): number => date.getDay(),

    // The Date constructor normalises overflow, which is DST-safe for date-only values.
    addDays: (date: Date, days: number): Date => create(getYear(date), getMonth(date), getDate(date) + days),
    addMonths: (date: Date, months: number): Date => {
      const target: Date = create(getYear(date), getMonth(date) + months, 1);
      const day: number = Math.min(getDate(date), getDaysInMonth(target));
      return create(getYear(target), getMonth(target), day);
    },
    addYears: (date: Date, years: number): Date => {
      const target: Date = create(getYear(date) + years, getMonth(date), 1);
      const day: number = Math.min(getDate(date), getDaysInMonth(target));
      return create(getYear(target), getMonth(target), day);
    },

    startOfMonth: (date: Date): Date => create(getYear(date), getMonth(date), 1),
    endOfMonth: (date: Date): Date => create(getYear(date), getMonth(date), getDaysInMonth(date)),
    getDaysInMonth,

    isSameDay: (a: Date, b: Date): boolean => compare(a, b) === 0,
    compare,
    clamp: (date: Date, min?: Date | null, max?: Date | null): Date => {
      if (min && compare(date, min) < 0) return new Date(min.getTime());
      if (max && compare(date, max) > 0) return new Date(max.getTime());
      return date;
    },
    isValid,

    parse: (value: string): Date | null => {
      const s: string = value.trim();
      if (!s) return null;
      const iso: RegExpExecArray | null = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
      let year: number;
      let month: number; // 1-based here
      let day: number;
      if (iso) {
        year = +iso[1];
        month = +iso[2];
        day = +iso[3];
      } else {
        const nums: RegExpMatchArray | null = s.match(/\d+/g);
        if (!nums || nums.length < 3) return null;
        const order: Array<'year' | 'month' | 'day'> = numericFieldOrder();
        year = 0;
        month = 0;
        day = 0;
        order.forEach((field, i) => {
          const n: number = parseInt(nums[i], 10);
          if (field === 'year') year = n;
          else if (field === 'month') month = n;
          else day = n;
        });
        if (year < 100) year += 2000; // 2-digit year
      }
      const date: Date = create(year, month - 1, day);
      // Reject overflow (e.g. Feb 30 → Mar 2): the components must round-trip.
      if (!isValid(date) || getMonth(date) !== month - 1 || getDate(date) !== day) return null;
      return date;
    },
    format: (date: Date, opts?: Intl.DateTimeFormatOptions): string =>
      new Intl.DateTimeFormat(locale, opts ?? { dateStyle: 'medium' }).format(date),

    firstDayOfWeek: (): number => {
      if (options.firstDayOfWeek !== undefined) return options.firstDayOfWeek;
      try {
        const loc: Intl.Locale = new Intl.Locale(locale ?? 'en');
        // `weekInfo` (getter) or `getWeekInfo()` per engine; firstDay is 1=Mon … 7=Sun.
        const info: { firstDay?: number } | undefined =
          (loc as unknown as { weekInfo?: { firstDay?: number }; getWeekInfo?: () => { firstDay?: number } }).weekInfo ??
          (loc as unknown as { getWeekInfo?: () => { firstDay?: number } }).getWeekInfo?.();
        if (info?.firstDay) return info.firstDay % 7; // 7(Sun)→0, 1(Mon)→1 … 6(Sat)→6
      } catch {
        /* engine without weekInfo */
      }
      return 0;
    },
    getDayOfWeekNames: (style: 'long' | 'short' | 'narrow'): string[] => {
      const fmt: Intl.DateTimeFormat = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' });
      return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(REF_SUNDAY_UTC + i * 86400000)));
    },
    getMonthNames: (style: 'long' | 'short' | 'narrow'): string[] => {
      const fmt: Intl.DateTimeFormat = new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' });
      return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2017, m, 1))));
    },
  };
  return adapter;
}
