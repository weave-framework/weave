import { signal } from '@weave-framework/runtime';
import Sidenav from '@weave-framework/ui/sidenav';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Sidenav;
void Button;

interface Setup {
  open: () => boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

/**
 * Controlled open state: drive `opened` from your own signal and update it in `onOpenedChange`.
 * The backdrop/Esc request a close through `onOpenedChange`, so you stay the single source of truth.
 */
export function setup(): Setup {
  const open = signal(false);
  return {
    open,
    setOpen: (v) => open.set(v),
    toggle: () => open.set((o) => !o),
  };
}
