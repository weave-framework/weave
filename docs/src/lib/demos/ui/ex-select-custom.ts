import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Country {
  code: string;
  name: string;
  region: string;
}

interface Setup {
  countries: Country[];
  optCode: (c: Country) => string;
  optName: (c: Country) => string;
  optRegion: (c: Country) => string;
  picked: () => Country | undefined;
  setPicked: (v: unknown) => void;
}

/**
 * Arbitrary option objects via accessors: `optionValue` / `optionLabel` /
 * `optionDescription` (subtext line). With `emit="object"`, `onChange` gets the whole
 * selected option back, not just its value string.
 */
export function setup(): Setup {
  const countries: Country[] = [
    { code: 'lt', name: 'Lithuania', region: 'Baltics' },
    { code: 'lv', name: 'Latvia', region: 'Baltics' },
    { code: 'pl', name: 'Poland', region: 'Central Europe' },
    { code: 'de', name: 'Germany', region: 'Central Europe' },
  ];
  const picked = signal<Country | undefined>(countries[0]);
  return {
    countries,
    optCode: (c) => c.code,
    optName: (c) => c.name,
    optRegion: (c) => c.region,
    picked,
    setPicked: (v) => picked.set(v as Country),
  };
}
