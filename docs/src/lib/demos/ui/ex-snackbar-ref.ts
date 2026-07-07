import Button from '@weave-framework/ui/button';
import { snackbar, type SnackbarRef } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  run: () => void;
}

/**
 * `snackbar()` returns a {@link SnackbarRef}: `element`, `dismiss()`, and
 * `afterDismissed()`. Here we await the promise to chain a follow-up bar.
 */
export function setup(): Setup {
  const run = (): void => {
    const ref: SnackbarRef = snackbar('Uploading…', { duration: 1500 });
    void ref.afterDismissed().then(() => snackbar('Upload complete'));
  };
  return { run };
}
