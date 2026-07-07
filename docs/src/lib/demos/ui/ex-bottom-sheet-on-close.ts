import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import { openBottomSheet } from '@weave-framework/ui/bottom-sheet';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  last: () => string;
  open: () => void;
}

/** `onClose(result)` fires when the sheet closes — here it drives a signal readout. */
export function setup(): Setup {
  const last = signal('—');

  const open = (): void => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Decline';
    no.className = 'weave-button weave-button--outline';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = 'Accept';
    yes.className = 'weave-button';
    actions.append(no, yes);

    const ref = openBottomSheet({
      title: 'Invitation',
      content: 'Accept or decline — the choice is reported back through onClose.',
      actions,
      onClose: (result) => last.set(result == null ? 'dismissed' : String(result)),
    });
    no.onclick = (): void => ref.close('declined');
    yes.onclick = (): void => ref.close('accepted');
  };

  return { last, open };
}
