import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: { value: string; label: string }[];
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/** A text field with a filtered suggestion listbox (composes the real Input under the hood). */
export function setup(): Setup {
  const chosen = signal('');
  const options = [
    { value: 'am', label: 'Amber' },
    { value: 'aq', label: 'Aqua' },
    { value: 'az', label: 'Azure' },
    { value: 'co', label: 'Coral' },
    { value: 'cr', label: 'Crimson' },
    { value: 'cy', label: 'Cyan' },
  ];
  return { options, chosen, onSelect: (item) => chosen.set((item as { label: string }).label) };
}
