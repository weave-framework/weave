import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  q: () => string;
  setQ: (v: string) => void;
}

/** The underline field bound to a signal via value + onInput. */
export function setup(): Setup {
  const q = signal('');
  return { q, setQ: (v) => q.set(v) };
}
