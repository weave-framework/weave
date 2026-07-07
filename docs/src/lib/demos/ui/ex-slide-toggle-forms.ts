import { field, validators, type Field } from '@weave-framework/forms';
import SlideToggle from '@weave-framework/ui/slide-toggle';

// Capitalized tags in the template resolve to this import.
void SlideToggle;

interface Setup {
  consent: Field<boolean>;
  consentError: () => string;
}

/**
 * `control` binds the toggle to a forms `Field<boolean>`: two-way value, touched-on-blur, and
 * `aria-invalid` while touched and invalid. `control` wins over `checked` + `onChange`.
 * `validators.required()` treats `false` as empty, so it reads as "must be on". The message shows
 * only once the field is `touched` — tab in, then out.
 */
export function setup(): Setup {
  const consent = field(false, [validators.required('You must enable this to continue')]);
  const consentError = (): string => (consent.touched() ? consent.error() ?? '' : '');
  return { consent, consentError };
}
