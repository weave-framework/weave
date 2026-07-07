import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import RadioGroup from '@weave-framework/ui/radio';

// Capitalized tags in the template resolve to these imports.
void FormField;
void RadioGroup;

interface Setup {
  plans: { value: string; label: string }[];
  plan: Field<string>;
  planError: () => string;
}

/**
 * `control` binds the group to a forms `Field<string>` (the selected key): two-way value,
 * touched-on-blur, and `aria-invalid` on the group while touched and invalid. `control` wins over
 * `value`/`onChange`. Starting empty, `validators.required()` reports until you pick one — the
 * message shows only once the field is `touched` (tab in, then out without choosing).
 */
export function setup(): Setup {
  const plan = field('', [validators.required('Please choose a plan')]);
  const planError = (): string => (plan.touched() ? plan.error() ?? '' : '');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team' },
  ];
  return { plans, plan, planError };
}
