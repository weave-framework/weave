/**
 * `<Tabs>` — a tablist with one visible panel (WAI-ARIA tabs pattern).
 *
 * A row of real `<button role=tab>`s over a 1px rule; the active tab is inked and
 * marked with a small accent square before its label (the Weave "mark" — no sliding
 * underline, which reads as Material). Exactly one `role=tabpanel` is shown; the rest
 * are `hidden`. Selection is the **active index** (design), controlled via `value` +
 * `onChange` or uncontrolled from `defaultIndex`.
 *
 * Tabs are an items-prop (`tabs`); each tab's **content is arbitrary** — a `Node`, a
 * string, or a factory `() => Node` — appended into its panel on mount. Roving tabindex
 * via the CDK `listKeyManager` (horizontal, wrap, skip-disabled): Left/Right/Home/End
 * move focus; **activation is manual by default** (Enter/Space/click selects) or follows
 * focus when `activateOnFocus`.
 *
 *   import Tabs from '@weave-framework/ui/tabs';
 *   <Tabs tabs={{ tabs }} value={{ index() }} onChange={{ setIndex }} />
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';

/** A tab panel's content: a DOM node, a plain string, or a factory returning a node. */
export type TabContent = Node | string | (() => Node);

export interface TabItem {
  /** Tab label text. */
  label: string;
  /** Panel content, shown when this tab is active. */
  content: TabContent;
  /** Disable just this tab (not selectable, skipped in keyboard nav). */
  disabled?: boolean;
}

export interface TabsProps {
  /** The tabs, left to right. */
  tabs: TabItem[];
  /** Controlled selected index. */
  value?: number;
  /** Called with the next index on selection. */
  onChange?: (index: number) => void;
  /** Uncontrolled initial index (ignored when `value` is provided). Default 0. */
  defaultIndex?: number;
  /** Selection follows focus as you arrow (auto-activation). Default false (manual). */
  activateOnFocus?: boolean;
  /** Disable the whole tab set. */
  disabled?: boolean;
  /** Accessible name for the tablist. */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }}>' +
  '<div class="weave-tabs__list" role="tablist" aria-label={{ label() }} on:keydown={{ onKeydown }}>' +
  '@for (tab of tabs(); track $index) {' +
  '<button class="weave-tabs__tab" type="button" role="tab" id={{ tabId($index) }}' +
  ' aria-controls={{ panelId($index) }} aria-selected={{ selectedAttr($index) }}' +
  ' aria-disabled={{ disabledAttr(tab) }} tabindex={{ tabTabindex($index) }}' +
  ' on:click={{ () => select($index) }}>' +
  '<span class="weave-tabs__label">{{ tab.label }}</span>' +
  '</button>' +
  '}' +
  '</div>' +
  '@for (tab of tabs(); track $index) {' +
  '<div class="weave-tabs__panel" role="tabpanel" id={{ panelId($index) }}' +
  ' aria-labelledby={{ tabId($index) }} tabindex="0" .hidden={{ isHidden($index) }}></div>' +
  '}' +
  '</div>';

export interface TabsContext {
  host: Signal<Element | null>;
  tabs: () => TabItem[];
  rootClass: () => string;
  label: () => string | undefined;
  tabId: (index: number) => string;
  panelId: (index: number) => string;
  selectedAttr: (index: number) => string;
  disabledAttr: (tab: TabItem) => string | undefined;
  tabTabindex: (index: number) => number;
  isHidden: (index: number) => boolean;
  select: (index: number) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

let _uid: number = 0;

function toNode(content: TabContent): Node {
  if (typeof content === 'function') return content();
  if (typeof content === 'string') return document.createTextNode(content);
  return content;
}

export function setup(props: TabsProps): TabsContext {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const uid: number = (_uid += 1);
  const uncontrolled: Signal<number> = signal<number>(props.defaultIndex ?? 0);

  const tabs = (): TabItem[] => props.tabs ?? [];
  const selectedIndex = (): number => (props.value !== undefined ? props.value : uncontrolled());
  const isTabDisabled = (tab: TabItem): boolean => !!props.disabled || !!tab.disabled;

  const tabId = (index: number): string => `weave-tabs-${uid}-tab-${index}`;
  const panelId = (index: number): string => `weave-tabs-${uid}-panel-${index}`;

  const manager: ListKeyManager<TabItem> = listKeyManager(tabs, {
    orientation: 'horizontal',
    wrap: true,
    skipDisabled: true,
    isDisabled: isTabDisabled,
  });

  // The single tabbable tab: the one the keyboard moved to, else the selected one.
  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    return active >= 0 ? active : selectedIndex();
  };

  const focusTab = (index: number): void => {
    const el: Element | null = host();
    el?.querySelectorAll<HTMLElement>('.weave-tabs__tab')[index]?.focus();
  };

  const select = (index: number): void => {
    const tab: TabItem | undefined = tabs()[index];
    if (!tab || isTabDisabled(tab)) return;
    manager.setActiveItem(index); // roving tab stop follows the interaction
    if (index === selectedIndex()) return;
    if (props.value === undefined) uncontrolled.set(index);
    props.onChange?.(index);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    // Sync the manager to the current tab stop before it navigates, so the first Arrow
    // moves relative to the selected/focused tab (not from index 0).
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === 'Enter' || event.key === ' ') {
      select(manager.activeIndex());
      event.preventDefault();
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      focusTab(manager.activeIndex());
      if (props.activateOnFocus) select(manager.activeIndex());
    }
  };

  // Panel contents are arbitrary — append them into their panels once in the DOM.
  onMount(() => {
    const el: Element | null = host();
    if (!el) return;
    const panels: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-tabs__panel');
    tabs().forEach((tab, i) => {
      panels[i]?.append(toNode(tab.content));
    });
  });

  return {
    host,
    tabs,
    rootClass: (): string => (props.class ? `weave-tabs ${props.class}` : 'weave-tabs'),
    label: (): string | undefined => props.label,
    tabId,
    panelId,
    selectedAttr: (index): string => (index === selectedIndex() ? 'true' : 'false'),
    disabledAttr: (tab): string | undefined => (isTabDisabled(tab) ? 'true' : undefined),
    tabTabindex: (index): number => {
      if (isTabDisabled(tabs()[index])) return -1;
      return index === rovingIndex() ? 0 : -1;
    },
    isHidden: (index): boolean => index !== selectedIndex(),
    select,
    onKeydown,
  };
}
