import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: { value: string; label: string }[];
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/**
 * `position` places the panel relative to the field (here `'top-start'` so it opens upward);
 * `class` forwards extra classes onto the root for styling hooks.
 */
export function setup(): Setup {
  const chosen = signal('');
  const options = [
    { value: 'ng', label: 'Angular' },
    { value: 'rc', label: 'React' },
    { value: 'vu', label: 'Vue' },
    { value: 'wv', label: 'Weave' },
  ];
  return { options, chosen, onSelect: (item) => chosen.set((item as { label: string }).label) };
}
