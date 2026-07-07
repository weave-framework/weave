import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  status: () => string;
  open: () => void;
}

/** Await the ref's `afterClosed()` promise, which resolves with the `close(result)` value. */
export function setup(): Setup {
  const status = signal('idle');

  const open = async (): Promise<void> => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; justify-content:flex-end;';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.className = 'weave-button';
    actions.append(del);

    const ref = openBottomSheet({
      title: 'Delete item?',
      content: 'Confirm to delete. We await afterClosed() and act on the resolved result.',
      actions,
    });
    del.onclick = (): void => ref.close('deleted');

    status.set('waiting…');
    const result = await ref.afterClosed();
    status.set(result === 'deleted' ? 'deleted' : 'kept');
  };

  return { status, open };
}
