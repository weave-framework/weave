import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** The minimal call: a `title` header and a string `content` body. */
export function setup(): Setup {
  const open = (): void => {
    openBottomSheet({
      title: 'Share',
      content: 'Choose how to share this — copy a link, email it, or export a file. Drag the handle down to dismiss.',
    });
  };
  return { open };
}
