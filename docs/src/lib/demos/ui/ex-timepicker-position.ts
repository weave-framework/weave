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
}

/** `position` chooses where the popover opens relative to the field — here it opens upward. */
export function setup(): Setup {
  const time = signal<Time | null>({ hours: 20, minutes: 15 });
  return { time, setTime: (v) => time.set(v) };
}
