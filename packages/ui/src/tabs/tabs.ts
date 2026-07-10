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

import { signal, effect, onMount, onDispose, type Signal } from '@weave-framework/runtime';
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
  '@if (hasTemplate()) {' +
  '@key (tabKey(tab, $index)) {' +
  '@render (tabBody(tab, $index))' +
  '}' +
  '}' +
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
  tabKey: (tab: TabItem<T>, index: number) => string;
  tabBody: (tab: TabItem<T>, index: number) => Node;
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

  // A stable-per-object version (minted on first sight) so a re-keyed `tabs` array with edited
  // data re-renders that button's template body, and its `@key` also folds in the selected state.
  let tabVersion: number = 0;
  const tabVersions: WeakMap<object, number> = new WeakMap<object, number>();
  const versionOf = (tab: TabItem<T>): number => {
    let v: number | undefined = tabVersions.get(tab as object);
    if (v === undefined) tabVersions.set(tab as object, (v = tabVersion += 1));
    return v;
  };

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

  // Panel contents are arbitrary — append them into their panels once in the DOM. (A tabTemplate
  // button body is rendered reactively in the template's keyed `@for` via `@render` — see tabBody —
  // so it survives a changing `tabs` set, unlike a one-shot onMount snapshot.)
  onMount(() => {
    const el: Element | null = host();
    if (!el) return;
    const panels: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-tabs__panel');
    tabs().forEach((tab, i) => {
      panels[i]?.append(toNode(tab.content));
    });

    // FW-13/FW-15 sliding indicator: slide + resize the indicator to the **currently-rendered**
    // active tab button on every selection change, when the `tabs` set changes, and on any layout
    // change (ResizeObserver → a bump signal). Geometry only; the CSS transition does the animation.
    // Torn down with the component (observer disconnected + any pending frame cancelled).
    if (props.slidingIndicator) {
      const bump: Signal<number> = signal<number>(0);
      const ro: ResizeObserver = new ResizeObserver(() => bump.set(bump() + 1));
      ro.observe(el); // container resizes (wrap, viewport)
      let frame: number = 0; // pending animation-frame handle (0 = none)

      // Measure the LIVE active button and place the indicator on it. Reads the selection fresh, so a
      // frame that coalesced several rapid selections lands on the final one.
      const measure = (): void => {
        frame = 0;
        const root: Element | null = host();
        const ind: Element | null = indicator();
        if (!(ind instanceof HTMLElement) || !root) return;
        const active: HTMLElement | null =
          root.querySelectorAll<HTMLElement>('.weave-tabs__tab')[selectedIndex()] ?? null;
        if (!active) return;
        // Observe the active button too: a much-later async resize (web-font / lazy icon load, well
        // after this frame) then re-fires this even when the list's own box is unchanged. Idempotent.
        ro.observe(active);
        // Never settle on a zero width (still not laid out); a later resize tick re-places it.
        if (active.offsetWidth === 0) return;
        ind.style.transform = `translateX(${active.offsetLeft}px)`;
        ind.style.width = `${active.offsetWidth}px`;
      };

      // Measure AFTER the browser has re-rendered + laid out the active button for the *new*
      // selection — never mid-flush. With a `tabTemplate`, changing selection re-renders the active
      // button's body; measuring synchronously reads it pre-layout (a partial, icon-sized box — the
      // FW-15 direction-reversal circle). Deferring to the next animation frame guarantees the DOM +
      // layout have settled first. Coalesced: rapid selections cancel the pending frame so only the
      // final one measures, and it never captures a partial width.
      const schedule = (): void => {
        if (typeof requestAnimationFrame !== 'function') {
          measure();
          return;
        }
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      };
      onDispose(() => {
        ro.disconnect();
        if (frame) cancelAnimationFrame(frame);
      });

      effect(() => {
        bump(); // re-schedule on any observed resize
        selectedIndex(); // …on selection change
        tabs(); // …and when the tab set changes (added/removed/reordered → buttons re-rendered)
        schedule();
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
    // `@key` value: re-render this tab's template body when its data (version) or selected state changes.
    tabKey: (tab, index): string => `${versionOf(tab)}:${index === selectedIndex()}`,
    // The tab button body Node — the authored `tabTemplate` fed this tab's TabRowContext. Only called
    // under `@if (hasTemplate())`, so `tabTemplate` is defined.
    tabBody: (tab, index): Node =>
      props.tabTemplate!({
        item: tab,
        label: tab.label,
        index,
        selected: index === selectedIndex(),
        disabled: isTabDisabled(tab),
      }),
    isHidden: (index): boolean => index !== selectedIndex(),
    select,
    onKeydown,
  };
}
