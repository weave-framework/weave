import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  vol: () => number;
  setVol: (v: number) => void;
  fmt: (v: number) => string;
}

/**
 * `format` turns the raw number into the spoken `aria-valuetext` (screen readers announce "40 %"
 * instead of "40"). It's the same function you'll want for your own readout.
 */
export function setup(): Setup {
  const vol = signal(40);
  return { vol, setVol: (v) => vol.set(v), fmt: (v) => `${v}%` };
}
