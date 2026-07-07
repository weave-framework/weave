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
  min: Time;
  max: Time;
  fmt: (t: Time | null) => string;
}

/** `min` / `max` clamp the committed time — the spinner can't leave 09:00–17:00. */
export function setup(): Setup {
  const time = signal<Time | null>({ hours: 12, minutes: 0 });
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    time,
    setTime: (v) => time.set(v),
    min: { hours: 9, minutes: 0 },
    max: { hours: 17, minutes: 0 },
    fmt: (t) => (t ? `${pad(t.hours)}:${pad(t.minutes)}` : '(none)'),
  };
}
