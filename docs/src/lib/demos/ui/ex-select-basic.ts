import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Setup {
  options: { value: string; label: string }[];
  country: () => string;
  setCountry: (v: unknown) => void;
}

/** Single-select combobox bound to a signal via value + onChange. */
export function setup(): Setup {
  const country = signal('lt');
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  return { options, country, setCountry: (v) => country.set(v as string) };
}
