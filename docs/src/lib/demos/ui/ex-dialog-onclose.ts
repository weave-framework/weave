import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
  last: () => string;
}

/** The `onClose` callback fires with the `close(result)` value (an alternative to `afterClosed()`). */
export function setup(): Setup {
  const last = signal('—');

  const open = (): void => {
    openDialog({
      title: 'Close me any way you like',
      content: 'Press Esc, click the backdrop, or leave — onClose runs with whatever result was passed.',
      onClose: (result) => last.set(result === undefined ? 'dismissed (no result)' : String(result)),
    });
  };

  return { open, last };
}
