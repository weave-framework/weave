import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string }[];
  marks: () => string[];
  setMarks: (v: string | string[]) => void;
}

/** Multi-select (multiple) — value is an array of the pressed keys. */
export function setup(): Setup {
  const marks = signal<string[]>(['bold']);
  const opts = [
    { value: 'bold', label: 'B' },
    { value: 'italic', label: 'I' },
    { value: 'underline', label: 'U' },
  ];
  return { opts, marks, setMarks: (v) => marks.set(v as string[]) };
}
