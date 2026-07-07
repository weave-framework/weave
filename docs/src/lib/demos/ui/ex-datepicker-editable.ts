import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  date: () => Date | null;
  setDate: (v: Date | null) => void;
  fmt: (d: Date | null) => string;
}

/**
 * `editable` swaps the button trigger for a typeable combobox input — type a date (parsed via the
 * adapter) or click the calendar icon to pick. Invalid text is flagged `aria-invalid`.
 */
export function setup(): Setup {
  const date = signal<Date | null>(null);
  return {
    date,
    setDate: (v) => date.set(v),
    fmt: (d) => (d ? d.toLocaleDateString() : '(none)'),
  };
}
