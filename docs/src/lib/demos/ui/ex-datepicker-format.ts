import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  fullFormat: Intl.DateTimeFormatOptions;
  fmt: (d: Date | null) => string;
}

/**
 * `displayFormat` is `Intl.DateTimeFormatOptions` for the field text (default `{ dateStyle: 'medium' }`);
 * `locale` drives the default adapter's format/parse, weekday names and first day of week.
 */
export function setup(): Setup {
  const date = signal<Date | null>(new Date());
  const fullFormat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return {
    date,
    setDate: (v) => date.set(v),
    fullFormat,
    fmt: (d) => (d ? d.toLocaleDateString() : '(none)'),
  };
}
