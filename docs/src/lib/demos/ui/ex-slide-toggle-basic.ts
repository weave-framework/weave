import { signal } from '@weave-framework/runtime';
import SlideToggle from '@weave-framework/ui/slide-toggle';

// Capitalized tags in the template resolve to this import.
void SlideToggle;

interface Setup {
  on: () => boolean;
  setOn: (v: boolean) => void;
}

/** An on/off switch (role=switch) bound to a boolean signal via checked + onChange. */
export function setup(): Setup {
  const on = signal(true);
  return { on, setOn: (v) => on.set(v) };
}
