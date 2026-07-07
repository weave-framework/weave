import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  burst: () => void;
}

/**
 * Only one snackbar shows at a time — concurrent calls queue and appear in
 * turn. Fire three at once and watch them drain one by one.
 */
export function setup(): Setup {
  const burst = (): void => {
    snackbar('First', { duration: 1500 });
    snackbar('Second', { duration: 1500 });
    snackbar('Third', { duration: 1500 });
  };
  return { burst };
}
