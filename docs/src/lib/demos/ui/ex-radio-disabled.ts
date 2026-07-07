import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

// Capitalized tags in the template resolve to this import.
void RadioGroup;

interface Setup {
  plans: { value: string; label: string; disabled?: boolean }[];
  plan: () => string;
  setPlan: (v: string) => void;
  locked: () => string;
}

/**
 * Two ways to disable: the whole group with the `disabled` prop, or a single option with `disabled`
 * on its `RadioOption` (here `team` is locked while the rest stay selectable).
 */
export function setup(): Setup {
  const plan = signal('pro');
  const locked = signal('free');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team', disabled: true },
  ];
  return {
    plans,
    plan,
    setPlan: (v) => plan.set(v),
    locked,
  };
}
