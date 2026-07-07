import { tooltip, type TooltipOptions } from '@weave-framework/ui/tooltip';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;

interface Setup {
  tooltip: typeof tooltip;
  instant: TooltipOptions;
  slow: TooltipOptions;
}

/**
 * `delay` (ms) is the hover grace period before the tooltip appears — `0` shows
 * instantly, a larger value waits. Keyboard focus always shows with no delay.
 */
export function setup(): Setup {
  return {
    tooltip,
    instant: { text: 'No wait — shows at once', delay: 0 },
    slow: { text: 'Patient — waits 800ms on hover', delay: 800 },
  };
}
