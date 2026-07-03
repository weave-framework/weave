import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

// Capitalized tags in the template resolve to this import.
void Stepper;

interface Setup {
  steps: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/** A wizard with built-in Back / Continue, bound to the current index. */
export function setup(): Setup {
  const idx = signal(0);
  const steps = [
    { label: 'Account', content: 'Step 1 — create your account.' },
    { label: 'Profile', content: 'Step 2 — fill in your profile.' },
    { label: 'Confirm', content: 'Step 3 — review and confirm.' },
  ];
  return { steps, idx, setIdx: (i) => idx.set(i) };
}
