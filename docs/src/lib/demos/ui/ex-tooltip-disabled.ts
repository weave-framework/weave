import { signal, computed } from '@weave-framework/runtime';
import { tooltip, type TooltipOptions } from '@weave-framework/ui/tooltip';

// `tooltip` is a use: action — it must be in scope for `use:tooltip` in the template.
void tooltip;

interface Setup {
  tooltip: typeof tooltip;
  opts: () => TooltipOptions;
  off: () => boolean;
  toggle: () => void;
}

/**
 * `disabled` suppresses the tooltip without detaching the action. Because the
 * options are signal-derived, flipping it reconfigures the same host live.
 */
export function setup(): Setup {
  const off = signal(false);
  const opts = computed<TooltipOptions>(() => ({ text: 'Now you see me', disabled: off() }));
  return { tooltip, opts, off, toggle: () => off.set(!off()) };
}
