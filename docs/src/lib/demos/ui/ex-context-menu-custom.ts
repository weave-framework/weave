import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Action {
  id: string;
  title: string;
  hint: string;
  blocked: boolean;
}

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  picked: () => string;
}

/**
 * Drive the menu from **arbitrary objects** via accessors: `optionValue`, `optionLabel`,
 * `optionDescription` and `optionDisabled` map each row to the menu fields. With
 * `emit: 'object'`, `onSelect` receives the whole selected object back (not just its value
 * string), so you have the full row to act on.
 */
export function setup(): Setup {
  const picked = signal('');
  const actions: Action[] = [
    { id: 'share', title: 'Share', hint: 'Anyone with the link', blocked: false },
    { id: 'star', title: 'Star', hint: 'Add to favourites', blocked: false },
    { id: 'lock', title: 'Lock', hint: 'Requires admin', blocked: true },
  ];
  const ctxOpts = {
    items: actions,
    optionValue: (a: Action) => a.id,
    optionLabel: (a: Action) => a.title,
    optionDescription: (a: Action) => a.hint,
    optionDisabled: (a: Action) => a.blocked,
    emit: 'object' as const,
    onSelect: (a: string | Action) => picked.set(typeof a === 'string' ? a : a.title),
  };
  return { contextMenu, ctxOpts, picked };
}
