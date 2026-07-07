import { signal, computed } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  name: () => string;
  setName: (v: string) => void;
  error: () => string;
}

/** The manual `error` prop: set it non-empty and the label + line go red, replacing the hint. */
export function setup(): Setup {
  const name = signal('');
  const error = computed(() => (name().trim() ? '' : 'Name is required'));
  return { name, setName: (v) => name.set(v), error };
}
