import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Datepicker from '@weave-framework/ui/datepicker';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Datepicker;

interface Setup {
  dob: Field<Date | null>;
  today: Date;
  dobError: () => string;
}

/**
 * `control` binds a forms `Field<Date | null>`: two-way value, touched-on-close, and the error
 * underline. The message shows only once the field is `touched`. Here the date of birth is required
 * and capped at today via `max`.
 */
export function setup(): Setup {
  const today = new Date();
  const dob = field<Date | null>(null, [validators.required('Date of birth is required')]);
  const dobError = (): string => (dob.touched() ? dob.error() ?? '' : '');
  return { dob, today, dobError };
}
