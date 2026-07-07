import { ripple } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
}

/** With no options the ripple blooms from the pointer where you press. */
export function setup(): Setup {
  return { ripple };
}
