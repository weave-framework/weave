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

/** The lean frame: a `label` above and a `hint` line below, a11y auto-wired to the slotted control. */
export function setup(): Setup {
  const email = signal('');
  return { email, setEmail: (v) => email.set(v) };
}
