import { signal } from '@weave-framework/runtime';
import DateRangePicker, { type DateRange } from '@weave-framework/ui/date-range-picker';

// Capitalized tags in the template resolve to this import.
void DateRangePicker;

interface Setup {
  range: () => DateRange | null;
  setRange: (v: DateRange | null) => void;
  fmt: (r: DateRange | null) => string;
}

/** The trigger field + range calendar, bound to a `DateRange | null` two-way with value + onChange. */
export function setup(): Setup {
  const range = signal<DateRange | null>(null);
  const one = (d: Date | null): string => (d ? d.toLocaleDateString() : '?');
  return {
    range,
    setRange: (v) => range.set(v),
    fmt: (r) => (r && r.start ? `${one(r.start)} → ${one(r.end)}` : '(none)'),
  };
}
