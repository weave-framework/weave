import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

// Capitalized tags in the template resolve to this import.
void Stepper;

interface Setup {
  steps: { label: string; content: string }[];
  idx: () => number;
  setIdx: (i: number) => void;
  done: () => boolean;
  submit: () => void;
}

/** A wizard bound to the current index, with built-in Back / Continue and onComplete. */
export function setup(): Setup {
  const idx = signal(0);
  const done = signal(false);
  const steps = [
    { label: 'Account', content: 'Step 1 — create your account.' },
    { label: 'Profile', content: 'Step 2 — fill in your profile.' },
    { label: 'Confirm', content: 'Step 3 — review and confirm.' },
  ];
  return {
    steps,
    idx,
    setIdx: (i) => idx.set(i),
    done,
    submit: () => done.set(true),
  };
}
