import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  vol: () => number;
  setVol: (v: number) => void;
  fmt: (v: number) => string;
}

/** A value over a range, bound to a signal. */
export function setup(): Setup {
  const vol = signal(40);
  return { vol, setVol: (v) => vol.set(v), fmt: (v) => `${v}%` };
}
