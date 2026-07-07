import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to this import.
void Datepicker;

interface Setup {
  a: () => Date | null;
  setA: (v: Date | null) => void;
  b: () => Date | null;
  setB: (v: Date | null) => void;
}

/** `disabled` blocks interaction; `required` sets `aria-required` for assistive tech. */
export function setup(): Setup {
  const a = signal<Date | null>(new Date());
  const b = signal<Date | null>(null);
  return {
    a,
    setA: (v) => a.set(v),
    b,
    setB: (v) => b.set(v),
  };
}
