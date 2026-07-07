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

/** `class` is forwarded onto the root, so you can widen or restyle a single instance. */
export function setup(): Setup {
  const time = signal<Time | null>({ hours: 10, minutes: 0 });
  return { time, setTime: (v) => time.set(v) };
}
