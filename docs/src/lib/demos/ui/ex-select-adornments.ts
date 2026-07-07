import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Select;
void Icon;

interface Setup {
  options: { value: string; label: string }[];
  country: () => string;
  setCountry: (v: unknown) => void;
}

/** Prefix / suffix slots — an icon or text flanking the trigger, like Input. */
export function setup(): Setup {
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  const country = signal('lt');
  return { options, country, setCountry: (v) => country.set(v as string) };
}
