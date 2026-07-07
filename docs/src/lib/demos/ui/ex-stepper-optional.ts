import { signal } from '@weave-framework/runtime';
import Stepper, { type StepItem } from '@weave-framework/ui/stepper';

// Capitalized tags in the template resolve to this import.
void Stepper;

interface Setup {
  steps: StepItem[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/**
 * An `optional` step shows an "Optional" caption and, in `linear` mode, doesn't
 * gate Continue — you can skip it without marking it `completed`.
 */
export function setup(): Setup {
  const idx = signal(0);
  const steps: StepItem[] = [
    { label: 'Basics', content: 'The required basics.', completed: true },
    { label: 'Extras', content: 'Nice-to-have extras — skip if you like.', optional: true },
    { label: 'Finish', content: 'Wrap it up.' },
  ];
  return { steps, idx, setIdx: (i) => idx.set(i) };
}
