import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  text: () => string;
  setText: (v: string) => void;
}

/** Clearable — the × shows only when the field is non-empty and editable; it empties + refocuses. */
export function setup(): Setup {
  const text = signal('Clear me');
  return { text, setText: (v) => text.set(v) };
}
