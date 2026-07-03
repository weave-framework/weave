import { tooltip } from '@weave-framework/ui/tooltip';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;

interface Setup {
  tooltip: typeof tooltip;
}

/** The tooltip action attached to a control. */
export function setup(): Setup {
  return { tooltip };
}
