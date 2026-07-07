import Stepper from '@weave-framework/ui/stepper';

// Capitalized tags in the template resolve to this import.
void Stepper;

interface Setup {
  steps: { label: string; content: string }[];
}

/**
 * Uncontrolled via `defaultIndex` (no `value`/`onChange` — the stepper owns its
 * index), with custom `backLabel` / `continueLabel` / `finishLabel`, an
 * accessible `label` for the step list, and an extra `class`.
 */
export function setup(): Setup {
  const steps = [
    { label: 'Pick a plan', content: 'Choose the plan that fits.' },
    { label: 'Add-ons', content: 'Bolt on any extras.' },
    { label: 'Review', content: 'Confirm and subscribe.' },
  ];
  return { steps };
}
