import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `dismissable={{ false }}` disables Esc + backdrop close — the user must use a button. */
export function setup(): Setup {
  const open = (): void => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; justify-content:flex-end;';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Got it';
    done.className = 'weave-button';
    actions.append(done);

    const ref = openBottomSheet({
      title: 'Please confirm',
      content: 'Esc and backdrop-click are disabled here — the only way out is the button below.',
      dismissable: false,
      actions,
    });
    done.onclick = (): void => ref.close();
  };
  return { open };
}
