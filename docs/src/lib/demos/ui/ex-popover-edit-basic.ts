import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig } from '@weave-framework/ui/popover-edit';

// `popoverEdit` is a use: action — it must be in scope for `use:popoverEdit`.
void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  cfg: PopoverEditConfig;
  name: () => string;
}

/**
 * The minimal contract: a `value` getter seeds the editor, `onCommit` receives the
 * new value on Enter / click-away. The options object lives in setup, not inline —
 * an inline object literal as a `use:` argument compiles to a JS block and is lost.
 */
export function setup(): Setup {
  const name = signal('Weave Project');
  const cfg: PopoverEditConfig = {
    value: () => name(),
    onCommit: (next) => name.set(next),
    label: 'Project name',
  };
  return { popoverEdit, cfg, name };
}
