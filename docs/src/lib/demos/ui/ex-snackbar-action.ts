import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  archive: () => void;
}

/** An `{ label, onAction }` action button whose callback fires on click. */
export function setup(): Setup {
  const archive = (): void => {
    snackbar('Message archived', {
      action: { label: 'Undo', onAction: () => snackbar('Restored') },
    });
  };
  return { archive };
}
