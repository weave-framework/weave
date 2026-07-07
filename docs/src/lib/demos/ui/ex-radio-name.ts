import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

// Capitalized tags in the template resolve to this import.
void RadioGroup;

interface Setup {
  sizes: { value: string; label: string }[];
  size: () => string;
  setSize: (v: string) => void;
}

/**
 * `name` sets the shared native `name` on every `<input type="radio">` (so a real `<form>` posts it,
 * and it's auto-generated if you omit it); `class` forwards extra classes onto the group container for
 * your own styling hooks.
 */
export function setup(): Setup {
  const size = signal('m');
  const sizes = [
    { value: 's', label: 'Small' },
    { value: 'm', label: 'Medium' },
    { value: 'l', label: 'Large' },
  ];
  return { sizes, size, setSize: (v) => size.set(v) };
}
