import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `dragToDismiss={{ false }}` hides the grab-handle and turns off drag-to-close. */
export function setup(): Setup {
  const open = (): void => {
    openBottomSheet({
      title: 'No handle',
      content: 'The top grab-handle is gone and a downward drag no longer closes the sheet. Use Esc or the backdrop.',
      dragToDismiss: false,
    });
  };
  return { open };
}
