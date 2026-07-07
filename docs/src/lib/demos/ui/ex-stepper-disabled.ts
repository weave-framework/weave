import { signal } from '@weave-framework/runtime';
import Stepper, { type StepItem } from '@weave-framework/ui/stepper';

// Capitalized tags in the template resolve to this import.
void Stepper;

interface Setup {
  steps: StepItem[];
  idx: () => number;
  setIdx: (i: number) => void;
  frozen: () => boolean;
  toggle: () => void;
}

/**
 * A per-step `disabled` flag makes one step non-navigable; the stepper-level
 * `disabled` prop freezes the whole control (header + built-in buttons).
 */
export function setup(): Setup {
  const idx = signal(0);
  const frozen = signal(false);
  const steps: StepItem[] = [
    { label: 'Start', content: 'The first step.' },
    { label: 'Locked', content: 'This step is disabled.', disabled: true },
    { label: 'End', content: 'The last step.' },
  ];
  return {
    steps,
    idx,
    setIdx: (i) => idx.set(i),
    frozen,
    toggle: () => frozen.set(!frozen()),
  };
}
