import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  sort: () => string;
}

/**
 * A **value-picker** context menu: `selected` marks the matching row (`role=menuitemradio` +
 * `aria-checked` + a check). Pass a getter so the mark tracks the value — re-read on every
 * right-click.
 */
export function setup(): Setup {
  const sort = signal('name');
  const ctxOpts = {
    items: [
      { value: 'name', label: 'Sort by name' },
      { value: 'date', label: 'Sort by date' },
      { value: 'size', label: 'Sort by size' },
    ],
    selected: () => sort(),
    onSelect: (v: string | { value: string }) => sort.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, sort };
}
