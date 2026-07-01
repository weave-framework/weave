/**
 * Context Menu — a right-click menu, applied as a Weave `use:` action to any host:
 *
 *   <div use:contextMenu={{ { items: [{value:'copy',label:'Copy'}], onSelect: run } }}>…</div>
 *
 * Binds `contextmenu` (right-click) on the host, suppresses the native menu, and opens the
 * SAME menu panel as `use:menu` — but anchored to a **virtual point** at the pointer (the
 * CDK positioner accepts any origin; it flips near the viewport edges). Also opens via the
 * keyboard context-menu key / Shift+F10 (anchored to the host), for native parity. Reuses
 * the menu core (roving focus, typeahead, Esc/click-away) and the `.weave-menu` visual — no
 * new styles. Zero-dep.
 */
import { openMenuPanel, virtualOrigin, type MenuHandle, type MenuItem } from '../menu/menu-core.js';

export type { MenuItem } from '../menu/menu-core.js';

export interface ContextMenuOptions {
  items: MenuItem[];
  /** Called with the chosen item's `value` (the menu then closes). */
  onSelect: (value: string) => void;
}

/** Weave `use:` action: `(host, options) => cleanup`. */
export function contextMenu(host: HTMLElement, options: ContextMenuOptions): () => void {
  let handle: MenuHandle | null = null;

  function openAt(x: number, y: number, focusFirst: boolean): void {
    handle?.close(false); // replace any open instance
    handle = openMenuPanel({
      origin: virtualOrigin(x, y),
      items: options.items,
      // Flip around the pointer: prefer down-right, fall back to the other quadrants.
      positions: ['bottom-start', 'top-start', 'bottom-end', 'top-end'],
      focusFirst,
      onSelect: options.onSelect,
      onClose: (returnFocus: boolean): void => {
        handle = null;
        if (returnFocus && typeof host.focus === 'function') host.focus();
      },
    });
  }

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    openAt(event.clientX, event.clientY, false); // pointer open: nothing pre-highlighted
  };
  const onKeydown = (event: KeyboardEvent): void => {
    // Keyboard parity: the ContextMenu key or Shift+F10 opens anchored to the host, first
    // item highlighted (there's no pointer to hover with).
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const r: DOMRect = host.getBoundingClientRect();
      openAt(r.left + 4, r.top + 4, true);
    }
  };

  host.addEventListener('contextmenu', onContextMenu);
  host.addEventListener('keydown', onKeydown);

  return (): void => {
    handle?.close(false);
    host.removeEventListener('contextmenu', onContextMenu);
    host.removeEventListener('keydown', onKeydown);
  };
}
