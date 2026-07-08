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
 * Each tab button renders its `label` by default; pass **`tabTemplate`** (an authored
 * `@snippet`, parallels the menu's `itemTemplate` — FW-10/FW-12) to render the whole
 * button content — an icon before the label, a badge, two lines — from the tab's data +
 * state. The framework still owns the `<button role=tab>`, ARIA, roving tabindex and the
 * panels; the template only fills the button's inner content.
 *
 *   import Tabs from '@weave-framework/ui/tabs';
 *   <Tabs tabs={{ tabs }} value={{ index() }} onChange={{ setIndex }} />
 */

import { signal, computed, effect, root, onMount, onDispose, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';

/** A tab panel's content: a DOM node, a plain string, or a factory returning a node. */
export type TabContent = Node | string | (() => Node);

export interface TabItem<T = unknown> {
  /** Tab label text — also the accessible name (`aria-label`) + typeahead when templated. */
  label: string;
  /** Panel content, shown when this tab is active. */
  content: TabContent;
  /** Disable just this tab (not selectable, skipped in keyboard nav). */
  disabled?: boolean;
  /** Arbitrary payload a {@link TabsProps.tabTemplate} can read (e.g. `{ icon: 'shield' }`). */
  data?: T;
}

/**
 * The per-tab context handed to a {@link TabsProps.tabTemplate}. The template (an authored
 * `@snippet`) renders the whole button content — icon/label/badge — binding these fields.
 * Parallels the menu's `MenuRowContext` (FW-10).
 */
export interface TabRowContext<T = unknown> {
  /** The tab's data object (bind `row.item.label`, `row.item.data.*`). */
  item: TabItem<T>;
  /** The tab's label — also the accessible name + typeahead text. */
  label: string;
  /** Zero-based position in the tab strip. */
  index: number;
  /**
   * True when this is the active tab. A snapshot; the template re-renders when it flips, so
   * you can restyle the active tab from it — or keep relying on the `[aria-selected='true']`
   * CSS hook the framework maintains on the button.
   */
  selected: boolean;
  /** Is this tab disabled (greyed, skipped by keyboard nav, not selectable). */
  disabled: boolean;
}

export interface TabsProps<T = unknown> {
  /** The tabs, left to right. */
  tabs: TabItem<T>[];
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
  /**
   * Renders the WHOLE content of each `role="tab"` button (replacing the default label span
   * + accent marker) from the tab's {@link TabRowContext}. The framework keeps the button,
   * ARIA, roving tabindex and panels. Omit for the default (label span + `::before` marker) —
   * fully back-compatible.
   */
  tabTemplate?: (row: TabRowContext<T>) => Node;
  /**
   * Opt-in: render one animated `.weave-tabs__indicator` element inside the tab list that slides +
   * resizes (`transform: translateX` + `width`) to the active tab's box on every selection (and on
   * resize). Default false — the static `::before` accent marker. The framework owns the element +
   * geometry; app CSS owns the look (fill, radius, height). Weave has no sliding marker by default,
   * so this must be asked for.
   */
  slidingIndicator?: boolean;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }}>' +
  '<div class="weave-tabs__list" role="tablist" aria-label={{ label() }} on:keydown={{ onKeydown }}>' +
  '@if (hasIndicator()) {' +
  '<div class="weave-tabs__indicator" ref={{ indicator }} aria-hidden="true"></div>' +
  '}' +
  '@for (tab of tabs(); track $index) {' +
  '<button class="weave-tabs__tab" type="button" role="tab" id={{ tabId($index) }}' +
  ' aria-controls={{ panelId($index) }} aria-selected={{ selectedAttr($index) }}' +
  ' aria-disabled={{ disabledAttr(tab) }} aria-label={{ ariaLabel(tab) }} tabindex={{ tabTabindex($index) }}' +
  ' on:click={{ () => select($index) }}>' +
  '@if (!hasTemplate()) {' +
  '<span class="weave-tabs__label">{{ tab.label }}</span>' +
  '}' +
  '</button>' +
  '}' +
  '</div>' +
  '@for (tab of tabs(); track $index) {' +
  '<div class="weave-tabs__panel" role="tabpanel" id={{ panelId($index) }}' +
  ' aria-labelledby={{ tabId($index) }} tabindex="0" .hidden={{ isHidden($index) }}></div>' +
  '}' +
  '</div>';

export interface TabsContext<T = unknown> {
  host: Signal<Element | null>;
  indicator: Signal<Element | null>;
  tabs: () => TabItem<T>[];
  rootClass: () => string;
  label: () => string | undefined;
  hasTemplate: () => boolean;
  hasIndicator: () => boolean;
  tabId: (index: number) => string;
  panelId: (index: number) => string;
  selectedAttr: (index: number) => string;
  disabledAttr: (tab: TabItem<T>) => string | undefined;
  ariaLabel: (tab: TabItem<T>) => string | undefined;
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

export function setup<T = unknown>(props: TabsProps<T>): TabsContext<T> {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const indicator: Signal<Element | null> = signal<Element | null>(null);
  const uid: number = (_uid += 1);
  const uncontrolled: Signal<number> = signal<number>(props.defaultIndex ?? 0);

  const tabs = (): TabItem<T>[] => props.tabs ?? [];
  const selectedIndex = (): number => (props.value !== undefined ? props.value : uncontrolled());
  const isTabDisabled = (tab: TabItem<T>): boolean => !!props.disabled || !!tab.disabled;
  const hasTemplate = (): boolean => typeof props.tabTemplate === 'function';
  const hasIndicator = (): boolean => !!props.slidingIndicator;

  const tabId = (index: number): string => `weave-tabs-${uid}-tab-${index}`;
  const panelId = (index: number): string => `weave-tabs-${uid}-panel-${index}`;

  const manager: ListKeyManager<TabItem<T>> = listKeyManager(tabs, {
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
    const tab: TabItem<T> | undefined = tabs()[index];
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

  // Panel contents are arbitrary — append them into their panels once in the DOM. When a
  // `tabTemplate` is supplied, fill each tab button with its rendered content too: reactive
  // per tab (rebuilt only when THAT tab's selected state flips), the render's bindings owned
  // by a `root` disposed before the next render (and on unmount) so nothing leaks.
  onMount(() => {
    const el: Element | null = host();
    if (!el) return;
    const panels: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-tabs__panel');
    tabs().forEach((tab, i) => {
      panels[i]?.append(toNode(tab.content));
    });

    const buttons: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-tabs__tab');

    const tpl: TabsProps<T>['tabTemplate'] = props.tabTemplate;
    if (tpl) {
      tabs().forEach((tab, i) => {
        const btn: HTMLElement | undefined = buttons[i];
        if (!btn) return;
        const isSelected: () => boolean = computed(() => i === selectedIndex());
        effect(() => {
          const selected: boolean = isSelected();
          return root((dispose) => {
            btn.replaceChildren(
              tpl({ item: tab, label: tab.label, index: i, selected, disabled: isTabDisabled(tab) })
            );
            return dispose;
          });
        });
      });
    }

    // FW-13 sliding indicator: measure the active tab's box and slide the indicator to it on every
    // selection change (reactive) and on any resize (ResizeObserver → a bump signal). Geometry only;
    // the CSS transition does the animation. Torn down with the component (observer disconnected).
    if (props.slidingIndicator) {
      const bump: Signal<number> = signal<number>(0);
      const ro: ResizeObserver = new ResizeObserver(() => bump.set(bump() + 1));
      ro.observe(el);
      onDispose(() => ro.disconnect());
      effect(() => {
        bump(); // re-measure on any resize
        const active: HTMLElement | undefined = buttons[selectedIndex()];
        const ind: Element | null = indicator();
        if (!(ind instanceof HTMLElement) || !active) return;
        ind.style.transform = `translateX(${active.offsetLeft}px)`;
        ind.style.width = `${active.offsetWidth}px`;
      });
    }
  });

  return {
    host,
    indicator,
    tabs,
    rootClass: (): string => (props.class ? `weave-tabs ${props.class}` : 'weave-tabs'),
    label: (): string | undefined => props.label,
    hasTemplate,
    hasIndicator,
    tabId,
    panelId,
    selectedAttr: (index): string => (index === selectedIndex() ? 'true' : 'false'),
    disabledAttr: (tab): string | undefined => (isTabDisabled(tab) ? 'true' : undefined),
    ariaLabel: (tab): string | undefined => (hasTemplate() ? tab.label : undefined),
    tabTabindex: (index): number => {
      if (isTabDisabled(tabs()[index])) return -1;
      return index === rovingIndex() ? 0 : -1;
    },
    isHidden: (index): boolean => index !== selectedIndex(),
    select,
    onKeydown,
  };
}
