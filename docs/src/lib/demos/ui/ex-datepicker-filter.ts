import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  isWeekday: (d: Date) => boolean;
  fmt: (d: Date | null) => string;
}

/** `dateFilter` returns false for excluded days — here weekends are disabled. */
export function setup(): Setup {
  const date = signal<Date | null>(null);
  const isWeekday = (d: Date): boolean => {
    const day = d.getDay();
    return day !== 0 && day !== 6;
  };
  return {
    date,
    setDate: (v) => date.set(v),
    isWeekday,
    fmt: (d) => (d ? d.toLocaleDateString() : '(none)'),
  };
}
