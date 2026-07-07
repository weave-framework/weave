import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig } from '@weave-framework/ui/popover-edit';

void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  cfg: PopoverEditConfig;
  nickname: () => string;
}

/**
 * `placeholder` fills the empty default editor with a hint; `label` is its accessible
 * name (also the overlay's aria-label). Start with an empty value to see the placeholder.
 */
export function setup(): Setup {
  const nickname = signal('');
  const cfg: PopoverEditConfig = {
    value: () => nickname(),
    onCommit: (next) => nickname.set(next),
    placeholder: 'e.g. Ada',
    label: 'Nickname',
  };
  return { popoverEdit, cfg, nickname };
}
