import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Input;

interface Setup {
  q: () => string;
  setQ: (v: string) => void;
}

/** Omit `label` for an unlabelled field — you still get the hint/error line and its a11y wiring. */
export function setup(): Setup {
  const q = signal('');
  return { q, setQ: (v) => q.set(v) };
}
