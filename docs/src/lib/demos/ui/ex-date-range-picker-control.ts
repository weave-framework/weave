import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import DateRangePicker, { type DateRange } from '@weave-framework/ui/date-range-picker';

// Capitalized tags in the template resolve to these imports.
void FormField;
void DateRangePicker;

interface Setup {
  stay: Field<DateRange | null>;
  today: Date;
  stayError: () => string;
}

/**
 * `control` binds a forms `Field<DateRange | null>`: two-way value, touched-on-close, and the
 * error underline. The message shows only once the field is `touched`. Here the stay is required
 * and can't start before today via `min`.
 */
export function setup(): Setup {
  const today = new Date();
  const stay = field<DateRange | null>(null, [validators.required('Please choose your stay')]);
  const stayError = (): string => (stay.touched() ? stay.error() ?? '' : '');
  return { stay, today, stayError };
}
