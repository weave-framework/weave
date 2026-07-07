import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

// Capitalized tags in the template resolve to this import.
void RadioGroup;

interface Setup {
  plans: { value: string; label: string }[];
  plan: () => string;
  setPlan: (v: string) => void;
}

/** A single-select radio group bound to a signal via value + onChange. */
export function setup(): Setup {
  const plan = signal('pro');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team' },
  ];
  return { plans, plan, setPlan: (v) => plan.set(v) };
}
