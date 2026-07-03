import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  armed: () => boolean;
  remove: () => void;
  label: () => string;
}

/** on:click event — a delete button that asks for confirmation first. */
export function setup(): Setup {
  const armed = signal(false);
  const remove = (): void => {
    if (!armed()) {
      armed.set(true); // first click: arm
      return;
    }
    // second click: actually delete…
    armed.set(false);
  };
  const label = (): string => (armed() ? 'Click again to confirm' : 'Delete');
  return { armed, remove, label };
}
