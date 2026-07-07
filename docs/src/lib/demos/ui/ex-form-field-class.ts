import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  handle: () => string;
  setHandle: (v: string) => void;
}

/** `class` is forwarded onto the root — here a utility that widens the field to fill its container. */
export function setup(): Setup {
  const handle = signal('');
  return { handle, setHandle: (v) => handle.set(v) };
}
