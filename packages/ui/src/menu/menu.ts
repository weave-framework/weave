/**
 * Menu — a dropdown of actions, applied as a Weave `use:` action to a trigger element:
 *
 *   <button use:menu={{ { items: [{value:'edit',label:'Edit'}, {value:'del',label:'Delete'}],
 *                        onSelect: (v) => run(v) } }}>Actions ▾</button>
 *
 * Click (or ArrowDown / Enter / Space) opens a CDK-overlay panel of `role=menuitem`
 * buttons anchored under the trigger (`connectedPosition`, flips on overflow). A
 * transparent backdrop catches click-away. Keyboard (WAI-ARIA menu pattern): roving
 * focus via the CDK `listKeyManager` (Up/Down/Home/End + typeahead, skips disabled),
 * Enter/Space activates, **Esc / Tab closes and returns focus to the trigger**. The
 * trigger carries `aria-haspopup=menu` + `aria-expanded`. Zero-dep.
 *
 * The visual is driven by `menu.styles()` (its own `--weave-menu-*` republic, reusing the
 * shared `overlay-panel` chrome); this file is only the behavior.
 */
import {
  createOverlay,
  connectedPosition,
  listKeyManager,
  type ListKeyManager,
  type OverlayRef,
  type PositionName,
} from '../cdk/index.js';

export interface MenuItem {
  /** Value passed to `onSelect`. */
  value: string;
  /** Visible label (also the typeahead text). */
  label: string;
  /** Greyed + skipped by keyboard nav; not selectable. */
  disabled?: boolean;
  /** Render a hairline separator here instead of an item (value/label ignored). */
  divider?: boolean;
}

export interface MenuOptions {
  items: MenuItem[];
  /** Called with the chosen item's `value` (the menu then closes). */
  onSelect: (value: string) => void;
  /** Preferred anchor position; flips to the opposite on overflow. Default `'bottom-start'`. */
  position?: PositionName;
}

/** Weave `use:` action: `(trigger, options) => cleanup`. */
export function menu(trigger: HTMLElement, options: MenuOptions): () => void {
  let ref: OverlayRef | null = null;
  let unsubBackdrop: (() => void) | null = null;
  let open: boolean = false;
  let itemEls: HTMLButtonElement[] = []; // enabled menuitems only, index-aligned with `enabled`

  const enabled = (): MenuItem[] => options.items.filter((it) => !it.divider && !it.disabled);
  const km: ListKeyManager<MenuItem> = listKeyManager<MenuItem>(enabled, {
    orientation: 'vertical',
    wrap: true,
    typeahead: true,
    getLabel: (it) => it.label,
  });

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  function buildPanel(): HTMLElement {
    const panel: HTMLElement = document.createElement('div');
    panel.className = 'weave-menu';
    panel.setAttribute('role', 'menu');
    itemEls = [];
    for (const it of options.items) {
      if (it.divider) {
        const sep: HTMLElement = document.createElement('div');
        sep.className = 'weave-menu__divider';
        sep.setAttribute('role', 'separator');
        panel.appendChild(sep);
        continue;
      }
      const btn: HTMLButtonElement = document.createElement('button');
      btn.type = 'button';
      btn.className = 'weave-menu__item';
      btn.setAttribute('role', 'menuitem');
      btn.tabIndex = -1; // roving: focus is moved programmatically
      btn.textContent = it.label;
      if (it.disabled) {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      } else {
        itemEls.push(btn);
        btn.addEventListener('click', () => select(it.value));
      }
      panel.appendChild(btn);
    }
    panel.addEventListener('keydown', onPanelKeydown);
    return panel;
  }

  function focusActive(): void {
    const idx: number = km.activeIndex();
    if (idx >= 0 && idx < itemEls.length) itemEls[idx].focus();
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const it: MenuItem | null = km.activeItem();
      if (it) select(it.value);
      return;
    }
    if (km.onKeydown(event)) {
      event.preventDefault();
      focusActive();
    }
  }

  function openMenu(): void {
    if (open || enabled().length === 0) return;
    ref = createOverlay({
      hasBackdrop: true,
      backdropClass: 'weave-overlay-backdrop--transparent',
      positionStrategy: connectedPosition(trigger, {
        positions: [options.position ?? 'bottom-start', 'top-start'],
        offset: 4,
      }),
    });
    unsubBackdrop = ref.onBackdropClick(() => close(false));
    ref.attach(buildPanel());
    trigger.setAttribute('aria-expanded', 'true');
    open = true;
    // Focus moves into the menu: the first enabled item (WAI-ARIA menu pattern).
    km.first();
    focusActive();
  }

  function close(returnFocus: boolean): void {
    if (!open) return;
    unsubBackdrop?.();
    unsubBackdrop = null;
    ref?.detach();
    trigger.setAttribute('aria-expanded', 'false');
    open = false;
    itemEls = [];
    if (returnFocus) trigger.focus();
  }

  function select(value: string): void {
    close(true);
    options.onSelect(value);
  }

  function toggle(): void {
    if (open) close(true);
    else openMenu();
  }

  const onTriggerClick = (): void => toggle();
  const onTriggerKeydown = (event: KeyboardEvent): void => {
    if (open) return; // once open, the panel owns the keyboard
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  };

  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeydown);

  return (): void => {
    close(false);
    ref?.dispose();
    ref = null;
    trigger.removeEventListener('click', onTriggerClick);
    trigger.removeEventListener('keydown', onTriggerKeydown);
    trigger.removeAttribute('aria-haspopup');
    trigger.removeAttribute('aria-expanded');
  };
}
