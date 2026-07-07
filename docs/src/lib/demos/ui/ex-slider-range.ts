import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  temp: () => number;
  setTemp: (v: number) => void;
}

/** Custom bounds with `min` / `max` — here a thermostat from 16 to 28 °C. */
export function setup(): Setup {
  const temp = signal(21);
  return { temp, setTemp: (v) => temp.set(v) };
}
