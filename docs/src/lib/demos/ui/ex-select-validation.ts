import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Select;

interface Setup {
  options: { value: string; label: string }[];
  country: Field<string>;
  countryError: () => string;
}

/**
 * `control` binds a forms `Field`: two-way value, `touched` on panel close, and the error
 * state. Wrapped in `<FormField>` for the label + error line. Open and close without picking
 * to see the message.
 */
export function setup(): Setup {
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  const country = field('', [validators.required('Please choose a country')]);
  const countryError = (): string => (country.touched() ? country.error() ?? '' : '');
  return { options, country, countryError };
}
