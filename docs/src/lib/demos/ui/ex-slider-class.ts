import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  v: () => number;
  setV: (v: number) => void;
}

/** `class` is forwarded onto the container — hook your own CSS onto it (here a wider fixed width). */
export function setup(): Setup {
  const v = signal(50);
  return { v, setV: (n) => v.set(n) };
}
