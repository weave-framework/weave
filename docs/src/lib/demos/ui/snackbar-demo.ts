import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  notify: () => void;
}

/** Show a snackbar imperatively with snackbar(). */
export function setup(): Setup {
  const notify = (): void => {
    snackbar('Project saved', { action: 'Undo', duration: 4000 });
  };
  return { notify };
}
