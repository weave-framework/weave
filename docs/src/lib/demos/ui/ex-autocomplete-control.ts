import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Autocomplete;

interface Setup {
  city: Field<string>;
  cityError: () => string;
  options: { value: string; label: string }[];
  onSelect: (item: unknown) => void;
}

/**
 * `control` binds the text to a forms `Field<string>` — two-way value, touched-on-blur, and the
 * invalid underline. `required` marks it native; the error shows only once `touched` (blur the
 * empty field). Selecting a suggestion writes the label through the control.
 */
export function setup(): Setup {
  const city = field('', [validators.required('Pick a city')]);
  const cityError = (): string => (city.touched() ? city.error() ?? '' : '');
  const options = [
    { value: 'lon', label: 'London' },
    { value: 'par', label: 'Paris' },
    { value: 'ber', label: 'Berlin' },
  ];
  return { city, cityError, options, onSelect: (item) => city.value.set((item as { label: string }).label) };
}
