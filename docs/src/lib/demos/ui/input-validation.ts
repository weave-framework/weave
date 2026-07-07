import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  email: Field<string>;
  emailError: () => string;
}

/**
 * `control` binds the field to a forms `Field<string>`: two-way value, touched-on-blur, and the
 * error underline. The message shows only once the field is `touched` — type an invalid address,
 * then blur.
 */
export function setup(): Setup {
  const email = field('', [validators.required('Email is required'), validators.email('Enter a valid email')]);
  const emailError = (): string => (email.touched() ? email.error() ?? '' : '');
  return { email, emailError };
}
