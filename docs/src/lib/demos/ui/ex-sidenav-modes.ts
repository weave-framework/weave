import { signal } from '@weave-framework/runtime';
import Sidenav, { type SidenavMode } from '@weave-framework/ui/sidenav';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Sidenav;
void Button;

interface Setup {
  mode: () => SidenavMode;
  opened: () => boolean;
  setOpened: (v: boolean) => void;
  pick: (m: SidenavMode) => void;
}

/**
 * The three fixed modes. `side` keeps the drawer in flow; `over` floats it above the content with a
 * dimming backdrop (Esc + backdrop close); `push` floats it *and* shifts the content across.
 */
export function setup(): Setup {
  const mode = signal<SidenavMode>('over');
  const opened = signal(true);
  return {
    mode,
    opened,
    setOpened: (v) => opened.set(v),
    pick: (m) => {
      mode.set(m);
      opened.set(true);
    },
  };
}
