import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

// Capitalized tags in the template resolve to this import.
void Input;

interface Setup {
  pw: () => string;
  setPw: (v: string) => void;
}

/** `revealable` on a `type="password"` field adds the eye toggle (hidden ↔ plaintext). */
export function setup(): Setup {
  const pw = signal('correct horse');
  return { pw, setPw: (v) => pw.set(v) };
}
