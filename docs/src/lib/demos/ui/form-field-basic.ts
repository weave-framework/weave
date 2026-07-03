import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  email: () => string;
  setEmail: (v: string) => void;
}

/** FormField wraps a control, adding a label + hint and wiring the a11y for you. */
export function setup(): Setup {
  const email = signal('');
  return { email, setEmail: (v) => email.set(v) };
}
