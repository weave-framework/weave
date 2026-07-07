import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: string[];
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/** `minChars` sets how many characters must be typed before the panel opens (here: 2). */
export function setup(): Setup {
  const chosen = signal('');
  const options = [
    'apple',
    'apricot',
    'avocado',
    'banana',
    'blackberry',
    'blueberry',
    'cherry',
    'cranberry',
  ];
  return { options, chosen, onSelect: (item) => chosen.set(item as string) };
}
