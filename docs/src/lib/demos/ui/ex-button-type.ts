import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  name: () => string;
  onName: (e: Event) => void;
  submitted: () => string;
  onSubmit: (e: Event) => void;
}

/**
 * `type` controls native form behavior: `submit` submits the surrounding form (and runs native
 * validation), `reset` clears its fields, and the default `button` does neither.
 */
export function setup(): Setup {
  const name = signal('');
  const submitted = signal('');
  return {
    name,
    onName: (e: Event): void => name.set((e.target as HTMLInputElement).value),
    submitted,
    onSubmit: (e: Event): void => {
      e.preventDefault();
      submitted.set(name());
    },
  };
}
