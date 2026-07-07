import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** A footer `actions` node whose buttons close the dialog with a result. */
export function setup(): Setup {
  const open = (): void => {
    // Build the footer row up front, then wire the buttons once we hold the ref.
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

    const ref = openDialog({
      title: 'Rename file',
      content: 'The header is fixed, the actions row is fixed, and only this body scrolls when tall.',
      actions,
    });
    cancel.onclick = (): void => ref.close();
    save.onclick = (): void => ref.close('saved');
  };
  return { open };
}
