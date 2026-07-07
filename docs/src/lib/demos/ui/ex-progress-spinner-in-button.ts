import { signal } from '@weave-framework/runtime';
import ProgressSpinner from '@weave-framework/ui/progress-spinner';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to these imports.
void ProgressSpinner;
void Button;

interface Setup {
  loading: () => boolean;
  save: () => void;
}

/** A signal-driven busy state — the small spinner sits inline while `loading` is true. */
export function setup(): Setup {
  const loading = signal(false);
  const save = (): void => {
    loading.set(true);
    setTimeout(() => loading.set(false), 2000);
  };
  return { loading, save };
}
