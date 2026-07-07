import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  start: () => void;
  center: () => void;
  end: () => void;
}

/**
 * `position` places the bar along the bottom edge: `'center'` (default),
 * `'start'`, or `'end'`. `start`/`end` are logical — flipped in RTL.
 */
export function setup(): Setup {
  const start = (): void => {
    snackbar('Bottom start', { position: 'start' });
  };
  const center = (): void => {
    snackbar('Bottom center', { position: 'center' });
  };
  const end = (): void => {
    snackbar('Bottom end', { position: 'end' });
  };
  return { start, center, end };
}
