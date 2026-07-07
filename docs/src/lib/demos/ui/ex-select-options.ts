import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Plan {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Setup {
  sizes: string[];
  size: () => string;
  setSize: (v: unknown) => void;
  plans: Plan[];
  plan: () => string;
  setPlan: (v: unknown) => void;
}

/**
 * Plain-string options need no accessors at all. `optionDisabled` (here the default
 * `.disabled` field) greys out an option and the key manager skips it.
 */
export function setup(): Setup {
  const sizes = ['Small', 'Medium', 'Large'];
  const size = signal('Medium');
  const plans: Plan[] = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'enterprise', label: 'Enterprise', disabled: true },
  ];
  const plan = signal('free');
  return {
    sizes,
    size,
    setSize: (v) => size.set(v as string),
    plans,
    plan,
    setPlan: (v) => plan.set(v as string),
  };
}
