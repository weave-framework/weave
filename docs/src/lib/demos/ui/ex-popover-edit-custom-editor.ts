import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig, type PopoverEditor } from '@weave-framework/ui/popover-edit';

void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  cfg: PopoverEditConfig;
  status: () => string;
}

const OPTIONS = ['Todo', 'In progress', 'Done'];

/**
 * `editor` is a factory: given the current value it returns `{ element, read, focusTarget? }`.
 * The action owns the overlay, commit and focus; you own the control. Here a native `<select>`
 * replaces the default text field — `read` reports its value, `focusTarget` gets initial focus.
 */
export function setup(): Setup {
  const status = signal('In progress');

  const selectEditor = (current: string): PopoverEditor => {
    const select = document.createElement('select');
    for (const label of OPTIONS) {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      if (label === current) opt.selected = true;
      select.appendChild(opt);
    }
    return { element: select, read: () => select.value, focusTarget: select };
  };

  const cfg: PopoverEditConfig = {
    value: () => status(),
    onCommit: (next) => status.set(next),
    label: 'Status',
    editor: selectEditor,
  };
  return { popoverEdit, cfg, status };
}
