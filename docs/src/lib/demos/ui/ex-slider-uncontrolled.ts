import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to this import.
void Slider;

/**
 * Uncontrolled: give a `defaultValue` and no `value`/`onChange`, and the slider keeps its own
 * internal state. Handy when you only read the value on submit rather than on every change.
 */
export function setup(): Record<string, never> {
  return {};
}
