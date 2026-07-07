import { field, validators, type Field } from '@weave-framework/forms';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to this import.
void Checkbox;

interface Setup {
  agree: Field<boolean>;
  agreeError: () => string;
}

/**
 * `control` binds the checkbox to a forms `Field<boolean>`: two-way value, touched-on-blur, and
 * `aria-invalid` while touched and invalid. `validators.required()` treats `false` as empty, so it
 * reads as "must accept". The message shows only once the field is `touched` — tab in, then out.
 */
export function setup(): Setup {
  const agree = field(false, [validators.required('You must accept the terms')]);
  const agreeError = (): string => (agree.touched() ? agree.error() ?? '' : '');
  return { agree, agreeError };
}
