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
 * Each row renders its `title` (+ optional `meta`) by default; pass **`rowTemplate`** (an
 * authored `@snippet`, parallels the menu's `itemTemplate` — FW-10 — and the tabs'
 * `tabTemplate` — FW-12) to render the whole row body — a colour dot, tag pills, a muted
 * description, trailing action buttons — from the row's data + state. The framework still
 * owns the `.weave-list__row`, its role (`option`/`listitem`), `aria-selected`, roving
 * tabindex, keyboard nav and (when `reorderable`) the drag handle rendered *before* the
 * template; the template only fills the row's inner content.
 *
 *   import List from '@weave-framework/ui/list';
 *   <List items={{ rows }} value={{ selected() }} onChange={{ setSelected }} />
 *   <List selectable={{ false }} items={{ rows }} />
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';
import { dropList, type DropEvent } from '../cdk/drag-drop.js';

export interface ListItem<T = unknown> {
  /** The value this row carries (what `value`/`onChange` speak in) — also the row key. */
  value: string;
  /** Primary text — the accessible name + typeahead target. */
  title: string;
  /** Secondary text, shown trailing/muted (unused when a `rowTemplate` renders its own body). */
  meta?: string;
  /** Disable just this row (skipped in keyboard nav, not selectable). */
  disabled?: boolean;
  /** Arbitrary payload a {@link ListProps.rowTemplate} can read (e.g. the source record). */
  data?: T;
}

/**
 * The per-row context handed to a {@link ListProps.rowTemplate}. The template (an authored
 * `@snippet`) renders the whole row body — dot/name/pills/description/actions — binding these
 * fields. Parallels the menu's `MenuRowContext` (FW-10) and tabs' `TabRowContext` (FW-12).
 */
export interface ListRowContext<T = unknown> {
  /** The row's data object (bind `row.item.title`, `row.item.data.*`). */
  item: ListItem<T>;
  /** The row's value/key. */
  value: string;
  /** The row's title — also the accessible name + typeahead text. */
  title: string;
  /** The row's meta text, if any. */
  meta?: string;
  /** The row's arbitrary payload (`item.data`) — the app's source record. */
  data?: T;
  /** Zero-based position in the list. */
  index: number;
  /**
   * True when this row is `aria-selected` (selectable mode). A snapshot; the template
   * re-renders when it flips, so you can restyle the active row from it — or keep relying on
   * the `[aria-selected='true']` CSS hook the framework maintains on the row.
   */
  selected: boolean;
  /** Is this row disabled (greyed, skipped by keyboard nav, not selectable). */
  disabled: boolean;
}

export interface ListProps<T = unknown> {
  /** The rows, top to bottom. */
  items: ListItem<T>[];
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
  /**
   * Renders the WHOLE body of each `.weave-list__row` (replacing the default title + meta
   * spans) from the row's {@link ListRowContext}. The framework keeps the row, its role,
   * `aria-selected`, roving tabindex, keyboard nav and (when `reorderable`) the drag handle,
   * which stays framework-rendered *before* the template content. `title` still drives the
   * accessible name + typeahead. Omit for the default (title + meta) — fully back-compatible.
   */
  rowTemplate?: (row: ListRowContext<T>) => Node;
}

// When `hasTemplate()`, the row body is the authored template's Node, mounted reactively INSIDE the
// keyed `@for` block via `@render` — so create / append / reload of `items` flows through the block's
// `track item.value` diffing (no one-shot onMount snapshot). `@key (rowKey)` re-renders just this
// row's body when its selected / disabled state flips (fresh ListRowContext), leaving the
// framework-owned drag handle above it untouched. Otherwise the default title + meta spans.
// NB: no `//` comments inside the concat below — the loader's static template extractor forbids them.
export const template: string =
  '<div class={{ listClass() }} ref={{ host }} role={{ listRole() }} aria-label={{ label() }}' +
  ' on:keydown={{ onKeydown }}>' +
  '@for (item of items(); track item.value) {' +
  '<div class="weave-list__row" role={{ rowRole() }} aria-selected={{ ariaSelected(item) }}' +
  ' aria-disabled={{ ariaDisabled(item) }} tabindex={{ tabindexFor(item) }}' +
  ' on:click={{ (e) => activate(item, e) }}>' +
  '@if (reorderable()) {<span class="weave-list__drag-handle" aria-hidden="true">⠿</span>}' +
  '@if (hasTemplate()) {' +
  '@key (rowKey(item)) {' +
  '@render (rowBody(item, $index))' +
  '}' +
  '}' +
  '@if (!hasTemplate()) {' +
  '<span class="weave-list__title">{{ item.title }}</span>' +
  '@if (item.meta) {<span class="weave-list__meta">{{ item.meta }}</span>}' +
  '}' +
  '</div>' +
  '}' +
  '</div>';

export interface ListContext<T = unknown> {
  host: Signal<Element | null>;
  items: () => ListItem<T>[];
  listClass: () => string;
  listRole: () => string;
  rowRole: () => string | undefined;
  reorderable: () => boolean;
  hasTemplate: () => boolean;
  label: () => string | undefined;
  ariaSelected: (item: ListItem<T>) => string | undefined;
  ariaDisabled: (item: ListItem<T>) => string | undefined;
  tabindexFor: (item: ListItem<T>) => number | undefined;
  rowKey: (item: ListItem<T>) => string;
  rowBody: (item: ListItem<T>, index: number) => Node;
  activate: (item: ListItem<T>, event?: Event) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

export function setup<T = unknown>(props: ListProps<T>): ListContext<T> {
  const host: Signal<Element | null> = signal<Element | null>(null);

  const items = (): ListItem<T>[] => props.items ?? [];
  const selectable = (): boolean => props.selectable !== false;
  const reorderable = (): boolean => !!props.reorderable;
  const hasTemplate = (): boolean => typeof props.rowTemplate === 'function';

  const listDisabled = (): boolean => !!props.disabled;
  const isItemDisabled = (item: ListItem<T>): boolean => listDisabled() || !!item.disabled;
  const isSelected = (item: ListItem<T>): boolean => selectable() && props.value === item.value;

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
      keyboard: false, // the listbox owns Space/Arrows (selection + roving) — pointer-drag only
      onDrop: (event: DropEvent) => props.onReorder?.(event),
    });
  });

  const manager: ListKeyManager<ListItem<T>> = listKeyManager(items, {
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
    const rows: ListItem<T>[] = items();
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

  const activate = (item: ListItem<T>, event?: Event): void => {
    if (!selectable() || isItemDisabled(item)) return;
    // A click that originated from an interactive descendant (a `<Button>`/link inside a
    // `rowTemplate`) is that control's click, not a row selection — ignore it. Keyboard
    // activation (Enter/Space) passes no event, so it always selects.
    if (event) {
      const target: Element | null = event.target as Element | null;
      if (target?.closest('button, a, [role="button"]')) return;
    }
    manager.setActiveItem(item); // roving tab stop follows the interaction
    if (props.value !== item.value) props.onChange?.(item.value);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!selectable()) return;
    // Sync the manager to the current tab stop before it navigates, so the first Arrow
    // moves relative to the selected/focused row (not from index 0).
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === ' ' || event.key === 'Enter') {
      const item: ListItem<T> | undefined = items()[manager.activeIndex()];
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
    hasTemplate,
    label: (): string | undefined => props.label,
    ariaSelected: (item): string | undefined => (selectable() ? (isSelected(item) ? 'true' : 'false') : undefined),
    ariaDisabled: (item): string | undefined => (selectable() && isItemDisabled(item) ? 'true' : undefined),
    tabindexFor: (item): number | undefined => {
      if (!selectable()) return undefined;
      if (isItemDisabled(item)) return -1;
      return items().indexOf(item) === rovingIndex() ? 0 : -1;
    },
    // The `@key` value: changing it re-renders this row's template body. Track the state the
    // ListRowContext exposes reactively (selected / disabled) so a flip rebuilds the body.
    rowKey: (item): string => `${isSelected(item)}:${isItemDisabled(item)}`,
    // The row body Node — the authored `rowTemplate` fed this row's full ListRowContext.
    // Only ever called under `@if (hasTemplate())`, so `rowTemplate` is defined.
    rowBody: (item, index): Node =>
      props.rowTemplate!({
        item,
        value: item.value,
        title: item.title,
        meta: item.meta,
        data: item.data,
        index,
        selected: isSelected(item),
        disabled: isItemDisabled(item),
      }),
    activate,
    onKeydown,
  };
}
