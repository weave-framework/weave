import { signal } from '@weave-framework/runtime';
import Stepper, { type StepItem } from '@weave-framework/ui/stepper';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to these imports.
void Stepper;
void Button;

interface Setup {
  steps: () => StepItem[];
  idx: () => number;
  setIdx: (i: number) => void;
  step0Done: () => boolean;
  step1Done: () => boolean;
  completeCurrent: () => void;
}

/**
 * `linear` gates forward navigation on a fully-`completed` prefix — Continue is
 * disabled and downstream steps are unreachable until the current one is marked
 * done. The `completed` flag is the consumer's to set (wire it to form validity).
 */
export function setup(): Setup {
  const idx = signal(0);
  const step0Done = signal(false);
  const step1Done = signal(false);

  const steps = (): StepItem[] => [
    { label: 'Terms', content: 'Accept the terms to continue.', completed: step0Done() },
    { label: 'Details', content: 'Fill in your details.', completed: step1Done() },
    { label: 'Done', content: 'All set — finish up.' },
  ];

  const completeCurrent = (): void => {
    if (idx() === 0) step0Done.set(true);
    else if (idx() === 1) step1Done.set(true);
  };

  return {
    steps,
    idx,
    setIdx: (i) => idx.set(i),
    step0Done,
    step1Done,
    completeCurrent,
  };
}
