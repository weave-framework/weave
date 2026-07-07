import { signal } from '@weave-framework/runtime';
import ProgressBar from '@weave-framework/ui/progress-bar';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to these imports.
void ProgressBar;
void Button;

interface Setup {
  pct: () => number;
  bump: () => void;
  reset: () => void;
}

/** Determinate — `value` (0–100, clamped) drives the fill; here a signal + buttons move it live. */
export function setup(): Setup {
  const pct = signal(40);
  return {
    pct,
    bump: (): void => pct.set((n) => Math.min(100, n + 10)),
    reset: (): void => pct.set(0),
  };
}
