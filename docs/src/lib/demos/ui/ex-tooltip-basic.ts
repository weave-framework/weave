import { tooltip } from '@weave-framework/ui/tooltip';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;

interface Setup {
  tooltip: typeof tooltip;
}

/** The simplest form: pass the hint as a bare string. Shows on hover and on focus. */
export function setup(): Setup {
  return { tooltip };
}
