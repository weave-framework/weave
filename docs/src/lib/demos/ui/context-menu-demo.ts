import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  picked: () => string;
}

/** A right-click context menu on a surface. */
export function setup(): Setup {
  const picked = signal('');
  const ctxOpts = {
    items: [
      { value: 'copy', label: 'Copy' },
      { value: 'paste', label: 'Paste' },
      { value: 'delete', label: 'Delete' },
    ],
    onSelect: (v: string | { value: string }) => picked.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, picked };
}
