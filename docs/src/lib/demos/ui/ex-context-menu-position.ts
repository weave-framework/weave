import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  picked: () => string;
}

/**
 * Set `position` and the panel anchors to the **host** at that spot instead of the pointer,
 * so the menu always appears in the same place regardless of where you right-clicked inside
 * the box. Here `bottom-start` opens it at the bottom-left corner (it still flips on
 * overflow). Omit `position` for the native pointer-anchored feel.
 */
export function setup(): Setup {
  const picked = signal('');
  const ctxOpts = {
    items: [
      { value: 'open', label: 'Open' },
      { value: 'rename', label: 'Rename' },
      { value: 'remove', label: 'Remove' },
    ],
    position: 'bottom-start',
    onSelect: (v: string | { value: string }) => picked.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, picked };
}
