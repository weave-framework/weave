import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  v: () => number;
  setV: (v: number) => void;
}

/** The default 0–100 range bound to a signal via `value` + `onChange`. */
export function setup(): Setup {
  const v = signal(40);
  return { v, setV: (n) => v.set(n) };
}
