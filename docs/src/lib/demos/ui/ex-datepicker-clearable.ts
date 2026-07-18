import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  fmt: (d: Date | null) => string;
}

/** `clearable` shows a clear button once a date is set; `clearLabel` names it for assistive tech. */
export function setup(): Setup {
  const date = signal<Date | null>(new Date());
  return {
    date,
    setDate: (v) => date.set(v),
    fmt: (d) => (d ? d.toLocaleDateString() : '(cleared)'),
  };
}
