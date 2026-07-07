import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  email: Field<string>;
}

/**
 * Pass the same forms `Field` to FormField's `control` and to the Input: the error state
 * auto-derives from `touched() && error()`, so the message shows only after you blur out of
 * an invalid field — no manual error string to compute.
 */
export function setup(): Setup {
  const email = field('', [validators.required('Email is required'), validators.email('Enter a valid email')]);
  return { email };
}
