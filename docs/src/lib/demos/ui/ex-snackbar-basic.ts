import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  save: () => void;
}

/** The simplest snackbar: a message with a string action, shown imperatively. */
export function setup(): Setup {
  const save = (): void => {
    snackbar('Project saved', { action: 'Undo' });
  };
  return { save };
}
