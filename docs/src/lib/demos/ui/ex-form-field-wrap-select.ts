import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Select;

interface Setup {
  options: { value: string; label: string }[];
  country: () => string;
  setCountry: (v: unknown) => void;
}

/** FormField frames any control, not just Input — here a Select. It finds the slotted control and wires the label. */
export function setup(): Setup {
  const country = signal('lt');
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  return { options, country, setCountry: (v) => country.set(v as string) };
}
