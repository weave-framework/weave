import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  open: () => void;
}

/** `dismissable: false` — Esc and backdrop clicks are ignored; only a button closes it. */
export function setup(): Setup {
  const open = (): void => {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; justify-content:flex-end;';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'I understand';
    ok.className = 'weave-button';
    actions.append(ok);

    const ref = openDialog({
      title: 'Action required',
      content: 'Try Esc or clicking outside — nothing happens. You have to make a choice.',
      dismissable: false,
      actions,
    });
    ok.onclick = (): void => ref.close('acknowledged');
  };
  return { open };
}
