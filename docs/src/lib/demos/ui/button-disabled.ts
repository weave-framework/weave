import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  disabled: () => boolean;
  toggle: () => void;
  count: () => number;
  hit: () => void;
  label: () => string;
}

/** The native `disabled` attribute — greys the button and suppresses click + ripple. */
export function setup(): Setup {
  const disabled = signal(true);
  const count = signal(0);
  return {
    disabled,
    toggle: (): void => disabled.set((d) => !d),
    count,
    hit: (): void => count.set((n) => n + 1),
    label: (): string => (disabled() ? 'Enable it' : 'Disable it'),
  };
}
