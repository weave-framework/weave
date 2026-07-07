import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** The minimum: openDialog() with a title + string content. */
export function setup(): Setup {
  const open = (): void => {
    openDialog({
      title: 'Welcome',
      content: 'This is a modal dialog. Press Esc, click the backdrop, or wait — it dismisses itself.',
    });
  };
  return { open };
}
