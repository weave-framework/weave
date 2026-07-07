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
 * `backdrop` forces the dimming scrim on (or off), independent of mode. Here a `push` drawer — which
 * normally has no backdrop — gets one; `backdrop={{ false }}` would suppress it in `over` mode.
 */
export function setup(): Setup {
  const open = signal(true);
  return {
    open,
    setOpen: (v) => open.set(v),
    toggle: () => open.set((o) => !o),
  };
}
