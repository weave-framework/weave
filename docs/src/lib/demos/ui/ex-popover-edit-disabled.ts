import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig } from '@weave-framework/ui/popover-edit';

void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  cfg: PopoverEditConfig;
  locked: () => boolean;
  toggle: () => void;
  amount: () => string;
}

/**
 * `disabled` takes a boolean or a reactive getter. Passing `() => locked()` makes
 * editing follow a signal — flip the lock and the same host stops opening the editor.
 */
export function setup(): Setup {
  const amount = signal('$42.00');
  const locked = signal(true);
  const cfg: PopoverEditConfig = {
    value: () => amount(),
    onCommit: (next) => amount.set(next),
    label: 'Amount',
    disabled: () => locked(),
  };
  return { popoverEdit, cfg, locked, toggle: () => locked.set(!locked()), amount };
}
