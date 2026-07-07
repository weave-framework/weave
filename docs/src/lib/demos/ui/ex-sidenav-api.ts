import { signal } from '@weave-framework/runtime';
import Sidenav, { type SidenavApi } from '@weave-framework/ui/sidenav';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Sidenav;
void Button;

interface Setup {
  onApi: (a: SidenavApi) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * The imperative handle. Grab `{ open, close, toggle, opened }` via the `api` ref callback and drive
 * the drawer from anywhere — the classic toolbar-hamburger pattern, no controlled signal required.
 */
export function setup(): Setup {
  const api = signal<SidenavApi | null>(null);
  return {
    onApi: (a) => api.set(a),
    open: () => api()?.open(),
    close: () => api()?.close(),
    toggle: () => api()?.toggle(),
  };
}
