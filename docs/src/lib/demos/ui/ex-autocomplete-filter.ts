import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Country {
  value: string;
  label: string;
}

interface Setup {
  options: Country[];
  filter: (item: Country, query: string) => boolean;
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/**
 * `filter` replaces the default label-contains match. Here it's a prefix match on either the
 * country name OR its ISO code, so typing `de` surfaces Germany (`DE`) first.
 */
export function setup(): Setup {
  const chosen = signal('');
  const options: Country[] = [
    { value: 'DE', label: 'Germany' },
    { value: 'DK', label: 'Denmark' },
    { value: 'FR', label: 'France' },
    { value: 'FI', label: 'Finland' },
    { value: 'SE', label: 'Sweden' },
  ];
  const filter = (item: Country, query: string): boolean => {
    const q = query.toLowerCase();
    return item.label.toLowerCase().startsWith(q) || item.value.toLowerCase().startsWith(q);
  };
  return { options, filter, chosen, onSelect: (item) => chosen.set((item as Country).label) };
}
