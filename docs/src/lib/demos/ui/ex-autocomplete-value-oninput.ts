import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: string[];
  text: () => string;
  setText: (v: string) => void;
  onSelect: (item: unknown) => void;
}

/** Controlled text: `value` + `onInput` bind the field two-way to a signal (like Input). */
export function setup(): Setup {
  const text = signal('');
  const options = ['Amsterdam', 'Berlin', 'Copenhagen', 'Dublin', 'Edinburgh', 'Florence'];
  return {
    options,
    text,
    setText: (v) => text.set(v),
    onSelect: (item) => text.set(item as string),
  };
}
