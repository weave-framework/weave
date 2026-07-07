import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  note: () => string;
  setNote: (v: string) => void;
}

/** `multiline` renders a `<textarea>` (with `rows`) instead of an `<input>`. */
export function setup(): Setup {
  const note = signal('');
  return { note, setNote: (v) => note.set(v) };
}
