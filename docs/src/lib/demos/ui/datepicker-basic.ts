import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  fmt: (d: Date | null) => string;
}

/** A date field + calendar popover, bound to a signal. */
export function setup(): Setup {
  const date = signal<Date | null>(null);
  return {
    date,
    setDate: (v) => date.set(v),
    fmt: (d) => (d ? d.toLocaleDateString() : '—'),
  };
}
