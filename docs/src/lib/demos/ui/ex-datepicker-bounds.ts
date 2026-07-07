import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  min: Date;
  max: Date;
  fmt: (d: Date | null) => string;
}

/** `min`/`max` (inclusive) disable out-of-range days. Here: only the current month is selectable. */
export function setup(): Setup {
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth(), 1);
  const max = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const date = signal<Date | null>(null);
  return {
    date,
    setDate: (v) => date.set(v),
    min,
    max,
    fmt: (d) => (d ? d.toLocaleDateString() : '(none)'),
  };
}
