import { signal } from '@weave-framework/runtime';
import { popoverEdit } from '@weave-framework/ui/popover-edit';

// `popoverEdit` is a use: action — it must be in scope for `use:popoverEdit`.
void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  editCfg: unknown;
  name: () => string;
}

/** Inline edit-in-place on a value, via the popoverEdit action. */
export function setup(): Setup {
  const name = signal('Weave Project');
  const editCfg = {
    value: () => name(),
    onCommit: (next: string) => name.set(next),
    label: 'Project name',
  };
  return { popoverEdit, editCfg, name };
}
