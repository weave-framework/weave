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
 * `items` can be plain strings — each is its own value and label. Because a string carries
 * no `divider` flag, supply `isDivider` to mark separators yourself; here the empty string
 * renders as a hairline between the groups.
 */
export function setup(): Setup {
  const picked = signal('');
  const ctxOpts = {
    items: ['Cut', 'Copy', 'Paste', '', 'Select all'],
    isDivider: (s: string) => s === '',
    onSelect: (v: string) => picked.set(v),
  };
  return { contextMenu, ctxOpts, picked };
}
