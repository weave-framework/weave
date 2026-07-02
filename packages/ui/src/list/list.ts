/**
 * `<List>` — a vertical list of rows (title + optional meta), in two modes:
 *
 * - **Selectable (default)** — listbox semantics: `role=listbox` with `role=option`
 *   rows, `aria-selected`, roving tabindex, and full keyboard navigation (Arrow / Home /
 *   End + typeahead on the row title) via the CDK `listKeyManager` (WAI-ARIA APG
 *   listbox). Selection is explicit — a click, or Enter / Space on the focused row —
 *   so arrowing moves focus without surprising the value. Value = the selected key.
 * - **Non-selectable (`selectable={{ false }}`)** — a plain semantic list: `role=list`
 *   with `role=listitem` rows, no roving, no selection, no keyboard capture.
 *
 * Selection state rides the native ARIA attribute (`aria-selected`), so the styling
 * hooks off `[aria-selected=true]` — the accentSoft tint + 2px accent left border —
 * with no state class. Value binding is controlled: pass `value` (a getter) + `onChange`;
 * forms (`use:control`) integration lands with the Checkbox pass that fixes the
 * control-binding convention.
 *
 *   import List from '@weave-framework/ui/list';
 *   <List items={{ rows }} value={{ selected() }} onChange={{ setSelected }} />
 *   <List selectable={{ false }} items={{ rows }} />
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';
import { dropList, type DropEvent } from '../cdk/drag-drop.js';

export interface ListItem {
  /** The value this row carries (what `value`/`onChange` speak in). */
  value: string;
  /** Primary text. */
  title: string;
  /** Secondary text, shown trailing/muted. */
  meta?: string;
  /** Disable just this row (skipped in keyboard nav, not selectable). */
  disabled?: boolean;
}

export interface ListProps {
  /** The rows, top to bottom. */
  items: ListItem[];
  /** Selectable (listbox) vs a plain semantic list. Default true. */
  selectable?: boolean;
  /** Controlled value: the selected row's key (single-select). */
  value?: string | null;
  /** Called with the next value on select (click / Enter / Space). */
  onChange?: (value: string) => void;
  /** Disable the whole list. */
  disabled?: boolean;
  /** Show a per-row drag handle and let rows be reordered by dragging it (CDK `dropList`). */
  reorderable?: boolean;
  /** Called on a committed reorder — the consumer reorders `items` (List is controlled). */
  onReorder?: (event: DropEvent) => void;
  /** Accessible name for the list. */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ listClass() }} ref={{ host }} role={{ listRole() }} aria-label={{ label() }}' +
  ' on:keydown={{ onKeydown }}>' +
  '@for (item of items(); track item.value) {' +
  '<div class="weave-list__row" role={{ rowRole() }} aria-selected={{ ariaSelected(item) }}' +
  ' aria-disabled={{ ariaDisabled(item) }} tabindex={{ tabindexFor(item) }}' +
  ' on:click={{ () => activate(item) }}>' +
  '@if (reorderable()) {<span class="weave-list__drag-handle" aria-hidden="true">⠿</span>}' +
  '<span class="weave-list__title">{{ item.title }}</span>' +
  '@if (item.meta) {<span class="weave-list__meta">{{ item.meta }}</span>}' +
  '</div>' +
  '}' +
  '</div>';

export interface ListContext {
  host: Signal<Element | null>;
  items: () => ListItem[];
  listClass: () => string;
  listRole: () => string;
  rowRole: () => string | undefined;
  reorderable: () => boolean;
  label: () => string | undefined;
  ariaSelected: (item: ListItem) => string | undefined;
  ariaDisabled: (item: ListItem) => string | undefined;
  tabindexFor: (item: ListItem) => number | undefined;
  activate: (item: ListItem) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

export function setup(props: ListProps): ListContext {
  const host: Signal<Element | null> = signal<Element | null>(null);

  const items = (): ListItem[] => props.items ?? [];
  const selectable = (): boolean => props.selectable !== false;
  const reorderable = (): boolean => !!props.reorderable;

  // Reorder via the CDK dropList — only the drag handle starts a drag (row clicks still
  // select). Committed drops emit onReorder; the consumer reorders `items` (controlled).
  onMount(() => {
    if (!props.reorderable) return;
    const el: Element | null = host();
    if (!el) return;
    dropList(el as HTMLElement, {
      itemSelector: '.weave-list__row',
      handle: '.weave-list__drag-handle',
      orientation: 'vertical',
      onDrop: (event: DropEvent) => props.onReorder?.(event),
    });
  });
  const listDisabled = (): boolean => !!props.disabled;
  const isItemDisabled = (item: ListItem): boolean => listDisabled() || !!item.disabled;
  const isSelected = (item: ListItem): boolean => selectable() && props.value === item.value;

  const manager: ListKeyManager<ListItem> = listKeyManager(items, {
    orientation: 'vertical',
    wrap: true,
    skipDisabled: true,
    isDisabled: isItemDisabled,
    typeahead: true,
    getLabel: (item) => item.title,
  });

  // The single tabbable row: the active one (once the keyboard has moved), else the
  // selected one, else the first enabled — so the listbox always has one tab stop.
  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    if (active >= 0) return active;
    const rows: ListItem[] = items();
    const selected: number = rows.findIndex((r) => isSelected(r) && !isItemDisabled(r));
    if (selected >= 0) return selected;
    const firstEnabled: number = rows.findIndex((r) => !isItemDisabled(r));
    return firstEnabled >= 0 ? firstEnabled : 0;
  };

  const focusRow = (index: number): void => {
    const el: Element | null = host();
    if (!el) return;
    const row: HTMLElement | undefined = el.querySelectorAll<HTMLElement>('.weave-list__row')[index];
    row?.focus();
  };

  const activate = (item: ListItem): void => {
    if (!selectable() || isItemDisabled(item)) return;
    manager.setActiveItem(item); // roving tab stop follows the interaction
    if (props.value !== item.value) props.onChange?.(item.value);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!selectable()) return;
    // Sync the manager to the current tab stop before it navigates, so the first Arrow
    // moves relative to the selected/focused row (not from index 0).
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === ' ' || event.key === 'Enter') {
      const item: ListItem | undefined = items()[manager.activeIndex()];
      if (item) {
        activate(item);
        event.preventDefault();
      }
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      focusRow(manager.activeIndex());
    }
  };

  return {
    host,
    items,
    listClass: (): string => {
      const parts: string[] = ['weave-list'];
      if (reorderable()) parts.push('weave-list--reorderable');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    listRole: (): string => (selectable() ? 'listbox' : 'list'),
    rowRole: (): string | undefined => (selectable() ? 'option' : 'listitem'),
    reorderable,
    label: (): string | undefined => props.label,
    ariaSelected: (item): string | undefined => (selectable() ? (isSelected(item) ? 'true' : 'false') : undefined),
    ariaDisabled: (item): string | undefined => (selectable() && isItemDisabled(item) ? 'true' : undefined),
    tabindexFor: (item): number | undefined => {
      if (!selectable()) return undefined;
      if (isItemDisabled(item)) return -1;
      return items().indexOf(item) === rovingIndex() ? 0 : -1;
    },
    activate,
    onKeydown,
  };
}
