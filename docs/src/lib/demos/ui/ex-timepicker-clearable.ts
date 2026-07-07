import { signal } from '@weave-framework/runtime';
import Timepicker from '@weave-framework/ui/timepicker';

// Capitalized tags in the template resolve to this import.
void Timepicker;

interface Time {
  hours: number;
  minutes: number;
}
interface Setup {
  time: () => Time | null;
  setTime: (v: Time | null) => void;
  fmt: (t: Time | null) => string;
}

/** `clearable` adds a `×` button (labelled by `clearLabel`) that resets the value to `null`. */
export function setup(): Setup {
  const time = signal<Time | null>({ hours: 18, minutes: 45 });
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    time,
    setTime: (v) => time.set(v),
    fmt: (t) => (t ? `${pad(t.hours)}:${pad(t.minutes)}` : '(cleared)'),
  };
}
