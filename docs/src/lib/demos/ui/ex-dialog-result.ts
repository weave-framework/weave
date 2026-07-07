import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
  choice: () => string;
}

/** Await the close result via `ref.afterClosed()`. */
export function setup(): Setup {
  const choice = signal('(not answered yet)');

  const open = async (): Promise<void> => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'No';
    no.className = 'weave-button weave-button--outline';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = 'Yes';
    yes.className = 'weave-button';
    actions.append(no, yes);

    const ref = openDialog({
      title: 'Enable notifications?',
      content: 'We\'ll ping you when something needs attention.',
      actions,
    });
    no.onclick = (): void => ref.close('declined');
    yes.onclick = (): void => ref.close('accepted');

    const result = await ref.afterClosed();
    choice.set(typeof result === 'string' ? result : 'dismissed');
  };

  return { open, choice };
}
