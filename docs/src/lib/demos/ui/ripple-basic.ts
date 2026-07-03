import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
  plain: RippleOptions;
  centered: RippleOptions;
}

/** The ripple action applied to any surface. Options are held in setup. */
export function setup(): Setup {
  return { ripple, plain: {}, centered: { centered: true } };
}
