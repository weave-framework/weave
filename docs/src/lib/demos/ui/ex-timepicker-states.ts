import { signal } from '@weave-framework/runtime';
import Timepicker from '@weave-framework/ui/timepicker';

// Capitalized tags in the template resolve to this import.
void Timepicker;

interface Time {
  hours: number;
  minutes: number;
}
interface Setup {
  a: () => Time | null;
  setA: (v: Time | null) => void;
  b: () => Time | null;
  setB: (v: Time | null) => void;
}

/** `disabled` makes the field inert (tabindex -1, no popover); `required` marks it via aria. */
export function setup(): Setup {
  const a = signal<Time | null>({ hours: 8, minutes: 0 });
  const b = signal<Time | null>(null);
  return {
    a,
    setA: (v) => a.set(v),
    b,
    setB: (v) => b.set(v),
  };
}
