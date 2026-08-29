import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Select from '@weave-framework/ui/select';
import type { SelectValue } from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Select;

type Country = { value: string; label: string };
interface Setup {
  options: Country[];
  // A select CLEARS to `undefined` and can hold a whole option object, so the field it binds to has
  // to be able to hold what the select puts in it — that is what `SelectValue` spells out.
  country: Field<SelectValue<Country>>;
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
  const country = field<SelectValue<Country>>('', [validators.required('Please choose a country')]);
  const countryError = (): string => (country.touched() ? country.error() ?? '' : '');
  return { options, country, countryError };
}
