import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to this import.
void Checkbox;

interface Setup {
  done: () => boolean;
  setDone: (v: boolean) => void;
}

/** A checkbox bound to a signal via checked + onChange. */
export function setup(): Setup {
  const done = signal(true);
  return { done, setDone: (v) => done.set(v) };
}
