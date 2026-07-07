import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig } from '@weave-framework/ui/popover-edit';

void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  cfg: PopoverEditConfig;
  title: () => string;
}

/**
 * `position` places the popover relative to the host (default `'bottom-start'`).
 * Here `'top-start'` opens the editor above the value. Named presets flip to their
 * opposite on overflow; an explicit anchor pair gives full 3×3 control.
 */
export function setup(): Setup {
  const title = signal('Q3 Report');
  const cfg: PopoverEditConfig = {
    value: () => title(),
    onCommit: (next) => title.set(next),
    label: 'Report title',
    position: 'top-start',
  };
  return { popoverEdit, cfg, title };
}
