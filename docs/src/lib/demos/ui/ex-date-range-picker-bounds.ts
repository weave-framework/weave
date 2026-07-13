import { signal } from '@weave-framework/runtime';
import DateRangePicker, { type DateRange } from '@weave-framework/ui/date-range-picker';

// Capitalized tags in the template resolve to this import.
void DateRangePicker;

interface Setup {
  range: () => DateRange | null;
  setRange: (v: DateRange | null) => void;
  today: Date;
  isWeekday: (d: Date) => boolean;
  fmt: (r: DateRange | null) => string;
}

/**
 * `min` (today) caps the earliest day; `dateFilter` disables weekends — a "weekdays from today"
 * range. Days outside the bounds are shown disabled and can't anchor or end a range.
 */
export function setup(): Setup {
  const range = signal<DateRange | null>(null);
  const today = new Date();
  const one = (d: Date | null): string => (d ? d.toLocaleDateString() : '?');
  return {
    range,
    setRange: (v) => range.set(v),
    today,
    isWeekday: (d) => d.getDay() !== 0 && d.getDay() !== 6,
    fmt: (r) => (r && r.start ? `${one(r.start)} → ${one(r.end)}` : '(none)'),
  };
}
