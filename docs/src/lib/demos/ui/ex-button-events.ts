import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  count: () => number;
  status: () => string;
  inc: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Native button events forward straight through. `on:click` is the common one, but any native
 * `<button>` event works the same — here `on:focus` / `on:blur` update a readout.
 */
export function setup(): Setup {
  const count = signal(0);
  const status = signal('idle');
  return {
    count,
    status,
    inc: (): void => count.set((n) => n + 1),
    onFocus: (): void => status.set('focused'),
    onBlur: (): void => status.set('blurred'),
  };
}
