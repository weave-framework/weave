import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface City {
  value: string;
  label: string;
}

interface Setup {
  optionsFor: (query: string) => Promise<City[]>;
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

const CITIES: City[] = [
  { value: 'lon', label: 'London' },
  { value: 'par', label: 'Paris' },
  { value: 'ber', label: 'Berlin' },
  { value: 'rom', label: 'Rome' },
  { value: 'mad', label: 'Madrid' },
  { value: 'vln', label: 'Vilnius' },
  { value: 'osl', label: 'Oslo' },
];

/**
 * `optionsFor(query)` fetches suggestions — return an array or a `Promise` for a real API call.
 * A promise fills a reactive cache, so the panel re-renders when results land; stale responses
 * (out-of-order) are ignored. `noResultsText` labels the empty row.
 */
export function setup(): Setup {
  const chosen = signal('');
  // Simulate a network round-trip.
  const optionsFor = (query: string): Promise<City[]> =>
    new Promise((resolve) => {
      const q = query.toLowerCase();
      setTimeout(() => resolve(CITIES.filter((c) => c.label.toLowerCase().includes(q))), 250);
    });
  return { optionsFor, chosen, onSelect: (item) => chosen.set((item as City).label) };
}
