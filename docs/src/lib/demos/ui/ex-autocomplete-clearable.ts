import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: { value: string; label: string }[];
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/** `clearable` shows a `×` button when the field is non-empty; `clearLabel` names it for AT. */
export function setup(): Setup {
  const chosen = signal('');
  const options = [
    { value: 'ng', label: 'Angular' },
    { value: 'rc', label: 'React' },
    { value: 'wv', label: 'Weave' },
  ];
  return { options, chosen, onSelect: (item) => chosen.set((item as { label: string }).label) };
}
