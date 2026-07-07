import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
  opts: RippleOptions;
}

/**
 * `centered: true` ignores the pointer and always emanates from the host's middle.
 * The options object lives in setup, not inline: an inline object literal as a `use:`
 * argument compiles to `() => { … }`, which JS reads as a block (the option is lost).
 */
export function setup(): Setup {
  const opts: RippleOptions = { centered: true };
  return { ripple, opts };
}
