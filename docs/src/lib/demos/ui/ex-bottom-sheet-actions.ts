import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** A footer button row (`actions`), wired to `close(result)` once we hold the ref. */
export function setup(): Setup {
  const open = (): void => {
    // Build the action row up front, then wire the buttons after we have the ref.
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.className = 'weave-button weave-button--outline';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.className = 'weave-button';
    actions.append(cancel, save);

    const ref = openBottomSheet({
      title: 'Edit filter',
      content: 'Adjust the filter, then Save to apply it or Cancel to discard.',
      actions,
    });
    cancel.onclick = (): void => ref.close();
    save.onclick = (): void => ref.close('saved');
  };
  return { open };
}
