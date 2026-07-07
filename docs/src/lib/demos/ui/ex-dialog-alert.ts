import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `role: 'alertdialog'` for a destructive confirmation. */
export function setup(): Setup {
  const open = (): void => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.className = 'weave-button weave-button--outline';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.className = 'weave-button';
    actions.append(cancel, del);

    const ref = openDialog({
      title: 'Delete project?',
      content: 'This permanently removes the project and all its data. It cannot be undone.',
      role: 'alertdialog',
      actions,
    });
    cancel.onclick = (): void => ref.close();
    del.onclick = (): void => ref.close('deleted');
  };
  return { open };
}
