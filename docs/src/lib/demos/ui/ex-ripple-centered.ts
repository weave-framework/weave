import { ripple } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
}

/** `centered: true` ignores the pointer and always emanates from the host's middle. */
export function setup(): Setup {
  return { ripple };
}
