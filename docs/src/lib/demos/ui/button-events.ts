import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  count: () => number;
  inc: () => void;
}

/** Basic usage — a primary <Button> that reacts to clicks. */
export function setup(): Setup {
  const count = signal(0);
  const inc = (): void => count.set((n) => n + 1);
  return { count, inc };
}
