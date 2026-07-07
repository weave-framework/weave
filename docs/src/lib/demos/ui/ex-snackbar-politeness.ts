import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  polite: () => void;
  assertive: () => void;
}

/**
 * `politeness` sets the screen-reader urgency of the live-region announcement:
 * `'polite'` (default, waits for a pause) or `'assertive'` (interrupts).
 */
export function setup(): Setup {
  const polite = (): void => {
    snackbar('Draft saved', { politeness: 'polite' });
  };
  const assertive = (): void => {
    snackbar('Connection lost', { politeness: 'assertive' });
  };
  return { polite, assertive };
}
