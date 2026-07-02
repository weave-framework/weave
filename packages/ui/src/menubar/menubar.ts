/**
 * `<Menubar>` — an app menu bar (File / Edit / View …), the WAI-ARIA **menubar** pattern. A
 * `role=menubar` row of top-level `<button role=menuitem>`s; activating one opens a dropdown
 * **Menu** — the same panel as the U3 `use:menu` (composed via `menu-core.openMenuPanel`, so
 * the panel chrome, roving focus, typeahead, Esc/backdrop are all reused, not re-created).
 *
 * Keyboard (APG menubar): Left/Right rove the top items (wrap), Home/End jump, typeahead;
 * **ArrowDown / Enter / Space open** the active menu (focused on its first item); while a menu
 * is open, **Left/Right switch to the neighbour's menu** (the classic menubar feel); Esc closes
 * and returns focus to the top item. A single roving tab stop.
 *
 *   import Menubar from '@weave-framework/ui/menubar';
 *   <Menubar menus={{ [{ label: 'File', items: [{ value: 'new', label: 'New' }] }] }}
 *            onSelect={{ (v) => run(v) }} />
 */
import { signal, onMount, onDispose, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/index.js';
import { openMenuPanel, buildPositions, type MenuItem, type MenuHandle } from '../menu/menu-core.js';

export interface MenubarMenu {
  /** Top-level label. */
  label: string;
  /** The dropdown items (reuses the Menu item model — `divider`, `disabled`, `description`). */
  items: MenuItem[];
  /** Disable this whole top item. */
  disabled?: boolean;
}

export interface MenubarProps {
  /** The top-level menus, left to right. */
  menus: MenubarMenu[];
  /** Called with the chosen item's value (or the whole item object). */
  onSelect?: (value: string | MenuItem) => void;
  /** Accessible name for the menubar. */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} role="menubar" aria-label={{ label() }} ref={{ host }} on:keydown={{ onKeydown }}>' +
  '@for (menu of menus(); track $index) {' +
  '<button class="weave-menubar__item" type="button" role="menuitem" aria-haspopup="menu"' +
  ' aria-expanded={{ expandedAttr($index) }} aria-disabled={{ disabledAttr(menu) }}' +
  ' tabindex={{ tabindexFor($index) }} on:click={{ () => onTopClick($index) }}>' +
  '{{ menu.label }}' +
  '</button>' +
  '}' +
  '</div>';

export interface MenubarContext {
  host: Signal<HTMLElement | null>;
  menus: () => MenubarMenu[];
  rootClass: () => string;
  label: () => string | undefined;
  expandedAttr: (index: number) => 'true' | 'false';
  disabledAttr: (menu: MenubarMenu) => 'true' | undefined;
  tabindexFor: (index: number) => number;
  onTopClick: (index: number) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

export function setup(props: MenubarProps): MenubarContext {
  const host: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const openIndex: Signal<number> = signal<number>(-1);
  let handle: MenuHandle | null = null;
  let arrowListener: ((event: KeyboardEvent) => void) | null = null;

  const menus = (): MenubarMenu[] => props.menus ?? [];
  const isDisabled = (menu: MenubarMenu): boolean => !!menu.disabled;

  const manager: ListKeyManager<MenubarMenu> = listKeyManager<MenubarMenu>(menus, {
    orientation: 'horizontal',
    wrap: true,
    skipDisabled: true,
    isDisabled,
    typeahead: true,
    getLabel: (m) => m.label,
  });

  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    if (active >= 0) return active;
    const first: number = menus().findIndex((m) => !isDisabled(m));
    return first >= 0 ? first : 0;
  };

  const topButtons = (): HTMLButtonElement[] =>
    Array.from(host()?.querySelectorAll<HTMLButtonElement>('.weave-menubar__item') ?? []);
  const focusTop = (index: number): void => {
    topButtons()[index]?.focus();
  };

  // Next enabled top index in a direction, wrapping.
  const nextEnabled = (from: number, step: number): number => {
    const list: MenubarMenu[] = menus();
    const n: number = list.length;
    for (let k: number = 1; k <= n; k++) {
      const i: number = (((from + step * k) % n) + n) % n;
      if (!isDisabled(list[i])) return i;
    }
    return from;
  };

  // While a menu is open, Left/Right switch to the neighbour's menu. The dropdown panel is
  // portaled (not a menubar descendant), so we catch these at the document (capture) level;
  // the menu core ignores Left/Right, so there's no conflict.
  const addArrowSwitch = (): void => {
    if (arrowListener) return;
    arrowListener = (event: KeyboardEvent): void => {
      if (openIndex() < 0) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        openMenu(nextEnabled(openIndex(), event.key === 'ArrowRight' ? 1 : -1));
      }
    };
    document.addEventListener('keydown', arrowListener, true);
  };
  const removeArrowSwitch = (): void => {
    if (arrowListener) document.removeEventListener('keydown', arrowListener, true);
    arrowListener = null;
  };

  function closeMenu(returnFocus: boolean): void {
    handle?.close(returnFocus);
  }

  function openMenu(index: number): void {
    const menu: MenubarMenu | undefined = menus()[index];
    if (!menu || isDisabled(menu)) return;
    handle?.close(false); // close any currently-open menu first (no focus bounce)
    const btn: HTMLButtonElement | undefined = topButtons()[index];
    if (!btn) return;
    manager.setActiveItem(index);
    handle = openMenuPanel<MenuItem>({
      origin: btn,
      items: menu.items,
      positions: buildPositions('bottom-start', 'bottom-start'),
      focusFirst: true, // a menubar always opens focused on the first item
      onSelect: (value) => props.onSelect?.(value),
      onClose: (returnFocus) => {
        handle = null;
        openIndex.set(-1);
        removeArrowSwitch();
        if (returnFocus) focusTop(index);
      },
    });
    if (handle) {
      openIndex.set(index);
      addArrowSwitch();
    }
  }

  const onTopClick = (index: number): void => {
    if (openIndex() === index) closeMenu(true);
    else openMenu(index);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(manager.activeIndex());
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      focusTop(manager.activeIndex());
    }
  };

  onMount(() => {
    // Seed the roving tab stop to the first enabled item.
    manager.setActiveItem(rovingIndex());
  });

  // Close any open dropdown when the menubar unmounts (the panel overlay is created outside
  // the owner scope, so tie its teardown here — else panels leak across renders/tests).
  onDispose(() => {
    handle?.close(false);
    removeArrowSwitch();
  });

  return {
    host,
    menus,
    rootClass: (): string => (props.class ? `weave-menubar ${props.class}` : 'weave-menubar'),
    label: (): string | undefined => props.label,
    expandedAttr: (index: number): 'true' | 'false' => (openIndex() === index ? 'true' : 'false'),
    disabledAttr: (menu: MenubarMenu): 'true' | undefined => (isDisabled(menu) ? 'true' : undefined),
    tabindexFor: (index: number): number => {
      if (isDisabled(menus()[index])) return -1;
      return index === rovingIndex() ? 0 : -1;
    },
    onTopClick,
    onKeydown,
  };
}
