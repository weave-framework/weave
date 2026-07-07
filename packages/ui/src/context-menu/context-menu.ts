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
import {
  openMenuPanel,
  buildPositions,
  virtualOrigin,
  type MenuHandle,
  type MenuItem,
  type MenuPosition,
  type OptionAccessors,
} from '../menu/menu-core.js';

export type { MenuItem, MenuPosition, OptionAccessors } from '../menu/menu-core.js';

// Pointer-anchored fallback order (down-right first, then the other quadrants).
const POINTER_POSITIONS: MenuPosition[] = ['bottom-start', 'top-start', 'bottom-end', 'top-end'];

export interface ContextMenuOptions<T = MenuItem> extends OptionAccessors<T> {
  /** The options — default shape, plain strings, or arbitrary objects (via `option*` accessors). */
  items: T[];
  /** Called with the chosen option (value string, or the whole object — see `emit`). */
  onSelect: (selected: string | T) => void;
  /** Mark a chosen value with a check (`role=menuitemradio`), turning it into a value picker.
   *  Pass a getter so the mark tracks the value; read on every open. See {@link MenuOptions.selected}. */
  selected?: string | (() => string | undefined);
  /** Is this option a hairline separator? Default: `item.divider`. */
  isDivider?: (item: T) => boolean;
  /**
   * Where the panel is anchored. **Omitted (default): at the pointer** (native right-click
   * feel). **Set to a position** (`'bottom-start'`, `'top-end'`, `'bottom'`, … or an explicit
   * anchor pair) → anchored to the **host object** at that position instead, so the menu
   * always appears in the same spot regardless of where inside the host you clicked.
   */
  position?: MenuPosition;
}

/** Weave `use:` action: `(host, options) => cleanup`. */
export function contextMenu<T = MenuItem>(host: HTMLElement, options: ContextMenuOptions<T>): () => void {
  let handle: MenuHandle | null = null;

  // Anchor to the host at `position` when set; otherwise to the given pointer point.
  function doOpen(focusFirst: boolean, pointer: { x: number; y: number } | null): void {
    handle?.close(false); // replace any open instance
    const objectAnchored: boolean = options.position != null || pointer == null;
    handle = openMenuPanel<T>({
      origin: objectAnchored ? host : virtualOrigin(pointer!.x, pointer!.y),
      items: options.items,
      positions: objectAnchored ? buildPositions(options.position, 'bottom-start') : POINTER_POSITIONS,
      focusFirst,
      isDivider: options.isDivider,
      selected: options.selected,
      optionValue: options.optionValue,
      optionLabel: options.optionLabel,
      optionDescription: options.optionDescription,
      optionDisabled: options.optionDisabled,
      emit: options.emit,
      onSelect: options.onSelect,
      onClose: (returnFocus: boolean): void => {
        handle = null;
        if (returnFocus && typeof host.focus === 'function') host.focus();
      },
    });
  }

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    // Pointer open: nothing pre-highlighted (unless `position` re-anchors it to the host).
    doOpen(false, { x: event.clientX, y: event.clientY });
  };
  const onKeydown = (event: KeyboardEvent): void => {
    // Keyboard parity: the ContextMenu key or Shift+F10 opens anchored to the host (no
    // pointer), first item highlighted.
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      doOpen(true, null);
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
