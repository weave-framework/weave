import Button from '@weave-framework/ui/button';
import { snackbar, type SnackbarRef } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  quick: () => void;
  sticky: () => void;
}

/**
 * `duration` sets the auto-dismiss delay (ms). `0` keeps the bar until it's
 * dismissed — here via the returned {@link SnackbarRef}, after 2s.
 */
export function setup(): Setup {
  const quick = (): void => {
    snackbar('Gone in a second', { duration: 1000 });
  };
  const sticky = (): void => {
    const ref: SnackbarRef = snackbar('Stays until dismissed', { duration: 0 });
    setTimeout(() => ref.dismiss(), 2000);
  };
  return { quick, sticky };
}
