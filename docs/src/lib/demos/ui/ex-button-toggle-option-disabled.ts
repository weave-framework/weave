import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string; disabled?: boolean }[];
  range: () => string;
  setRange: (v: string | string[]) => void;
}

/** `disabled` on a single option greys it out and skips it in keyboard nav. */
export function setup(): Setup {
  const range = signal('day');
  const opts = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'year', label: 'Year', disabled: true },
  ];
  return { opts, range, setRange: (v) => range.set(v as string) };
}
