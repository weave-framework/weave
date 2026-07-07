import { tooltip, type TooltipOptions } from '@weave-framework/ui/tooltip';
import Button from '@weave-framework/ui/button';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;
// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  tooltip: typeof tooltip;
  deleteTip: TooltipOptions;
}

/**
 * A tooltip attaches to a composed `<Button>` too — `use:` forwards to its root.
 * The options object lives in setup (not inline in the template): an inline object
 * literal as a `use:` argument compiles to `() => { … }`, which JS reads as a block.
 */
export function setup(): Setup {
  const deleteTip: TooltipOptions = { text: 'This cannot be undone', position: 'bottom' };
  return { tooltip, deleteTip };
}
