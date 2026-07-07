import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Timepicker from '@weave-framework/ui/timepicker';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Timepicker;

interface Time {
  hours: number;
  minutes: number;
}
interface Setup {
  start: Field<Time | null>;
  startError: () => string;
}

/**
 * `control` binds the Timepicker to a forms `Field<TimeValue>` — two-way value, touched-on-close, and
 * the invalid state. `required` makes the empty field invalid; the error shows only once `touched`
 * (open then click away without picking).
 */
export function setup(): Setup {
  const start = field<Time | null>(null, [validators.required('Pick a start time')]);
  const startError = (): string => (start.touched() ? start.error() ?? '' : '');
  return { start, startError };
}
