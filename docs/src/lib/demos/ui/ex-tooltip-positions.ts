import { tooltip, type TooltipOptions } from '@weave-framework/ui/tooltip';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;

interface Setup {
  tooltip: typeof tooltip;
  top: TooltipOptions;
  bottom: TooltipOptions;
  left: TooltipOptions;
  right: TooltipOptions;
}

/**
 * `position` picks the preferred side; the CDK positioner flips to the opposite
 * on overflow. Pass an options object instead of a bare string.
 */
export function setup(): Setup {
  return {
    tooltip,
    top: { text: 'Above', position: 'top' },
    bottom: { text: 'Below', position: 'bottom' },
    left: { text: 'To the left', position: 'left' },
    right: { text: 'To the right', position: 'right' },
  };
}
