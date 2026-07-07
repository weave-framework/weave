import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

interface Setup {
  rating: () => number;
  setRating: (v: number) => void;
}

/** A coarse `step` — values snap to the grid (measured from `min`), so arrows and drag land on multiples of 10. */
export function setup(): Setup {
  const rating = signal(30);
  return { rating, setRating: (v) => rating.set(v) };
}
