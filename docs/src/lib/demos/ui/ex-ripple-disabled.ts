import { ripple } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
}

/** `disabled: true` suppresses ripples while leaving the action attached. */
export function setup(): Setup {
  return { ripple };
}
