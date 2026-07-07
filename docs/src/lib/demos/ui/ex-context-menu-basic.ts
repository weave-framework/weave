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
 * The default: `items` of `{ value, label }` plus an `onSelect`. Right-click the surface
 * (or press the context-menu key / Shift+F10) — the native menu is suppressed and this one
 * opens at the pointer. The options object lives in setup, never inline: an inline object
 * literal as a `use:` argument compiles to `() => { … }` (a JS block; the options are lost).
 */
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
