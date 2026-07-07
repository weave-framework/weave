import { signal, computed } from '@weave-framework/runtime';
import { ripple, type RippleOptions } from '@weave-framework/ui/ripple';

// `ripple` is a use: action — it must be in scope for `use:ripple` in the template.
void ripple;

interface Setup {
  ripple: typeof ripple;
  opts: () => RippleOptions;
  off: () => boolean;
  toggle: () => void;
}

/**
 * Options can be a signal-derived object, so the ripple reconfigures live.
 * Here a checkbox flips `disabled` on the same host without re-attaching the action.
 */
export function setup(): Setup {
  const off = signal(false);
  const opts = computed<RippleOptions>(() => ({ centered: true, disabled: off() }));
  return { ripple, opts, off, toggle: () => off.set(!off()) };
}
