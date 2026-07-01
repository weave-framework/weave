/**
 * `<Expansion>` — an accordion of collapsible panels (WAI-ARIA accordion pattern).
 *
 * Each panel is a `<button>` header (title + a `+`/`−` marker) that toggles a
 * `role=region` body revealed below it. The open header takes the `--field` tint;
 * the body animates open via a `grid-template-rows` transition. **Panels are
 * independent by default** (`multi` — any number open); pass `multi={{ false }}`
 * for single-open (opening one closes the rest).
 *
 * Structural metadata is an items-prop (`panels`); each panel's **body is arbitrary
 * content** — a `Node`, a string, or a factory `() => Node` (same shape as Dialog
 * content) — appended into its region on mount. Open state is controlled via
 * `value` (open panel ids) + `onChange`, or uncontrolled from `defaultOpen`.
 *
 * a11y: header `<button aria-expanded aria-controls>` inside a `role=heading`
 * (level via `headingLevel`, default 3); region `role=region aria-labelledby`,
 * `inert` + `aria-hidden` while collapsed. Up/Down/Home/End move focus between
 * enabled headers; Enter/Space toggle (native button).
 *
 *   import Expansion from '@weave-framework/ui/expansion';
 *   <Expansion panels={{ panels }} value={{ open() }} onChange={{ setOpen }} />
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';

/** A panel body: a DOM node, a plain string, or a factory returning a node. */
export type ExpansionContent = Node | string | (() => Node);

export interface ExpansionPanel {
  /** Stable id — what `value`/`onChange` speak in, and the open-set key. */
  id: string;
  /** Header title text. */
  header: string;
  /** Body content, revealed when the panel is open. */
  body: ExpansionContent;
  /** Disable just this panel (not toggleable, skipped in keyboard nav). */
  disabled?: boolean;
}

export interface ExpansionProps {
  /** The panels, top to bottom. */
  panels: ExpansionPanel[];
  /** Independent panels (any number open). Default true; false = single-open. */
  multi?: boolean;
  /** Controlled open set: the ids of the open panels. */
  value?: string[];
  /** Called with the next open set on toggle. */
  onChange?: (openIds: string[]) => void;
  /** Uncontrolled initial open set (ignored when `value` is provided). */
  defaultOpen?: string[];
  /** Disable the whole accordion. */
  disabled?: boolean;
  /** aria-level for each header's heading wrapper. Default 3. */
  headingLevel?: number;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }}>' +
  '@for (panel of panels(); track panel.id) {' +
  '<div class="weave-expansion__panel">' +
  '<div class="weave-expansion__heading" role="heading" aria-level={{ headingLevel() }}>' +
  '<button class="weave-expansion__header" type="button" id={{ headerId(panel) }}' +
  ' aria-expanded={{ expandedAttr(panel) }} aria-controls={{ regionId(panel) }}' +
  ' aria-disabled={{ disabledAttr(panel) }} on:click={{ () => toggle(panel) }}' +
  ' on:keydown={{ onHeaderKeydown }}>' +
  '<span class="weave-expansion__title">{{ panel.header }}</span>' +
  '<span class="weave-expansion__marker" aria-hidden="true"></span>' +
  '</button>' +
  '</div>' +
  '<div class="weave-expansion__region" id={{ regionId(panel) }} role="region"' +
  ' aria-labelledby={{ headerId(panel) }} data-open={{ openAttr(panel) }}' +
  ' aria-hidden={{ hiddenAttr(panel) }} .inert={{ isClosed(panel) }}>' +
  '<div class="weave-expansion__body"><div class="weave-expansion__content"></div></div>' +
  '</div>' +
  '</div>' +
  '}' +
  '</div>';

export interface ExpansionContext {
  host: Signal<Element | null>;
  panels: () => ExpansionPanel[];
  rootClass: () => string;
  headingLevel: () => number;
  headerId: (panel: ExpansionPanel) => string;
  regionId: (panel: ExpansionPanel) => string;
  expandedAttr: (panel: ExpansionPanel) => string;
  openAttr: (panel: ExpansionPanel) => string | undefined;
  hiddenAttr: (panel: ExpansionPanel) => string | undefined;
  disabledAttr: (panel: ExpansionPanel) => string | undefined;
  isClosed: (panel: ExpansionPanel) => boolean;
  toggle: (panel: ExpansionPanel) => void;
  onHeaderKeydown: (event: KeyboardEvent) => void;
}

let _uid: number = 0;

function toNode(content: ExpansionContent): Node {
  if (typeof content === 'function') return content();
  if (typeof content === 'string') return document.createTextNode(content);
  return content;
}

export function setup(props: ExpansionProps): ExpansionContext {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const uid: number = (_uid += 1);
  const uncontrolled: Signal<string[]> = signal<string[]>(props.defaultOpen ?? []);

  const panels = (): ExpansionPanel[] => props.panels ?? [];
  const multi = (): boolean => props.multi !== false;
  const openIds = (): string[] => (props.value !== undefined ? (props.value ?? []) : uncontrolled());
  const isOpen = (panel: ExpansionPanel): boolean => openIds().includes(panel.id);
  const isPanelDisabled = (panel: ExpansionPanel): boolean => !!props.disabled || !!panel.disabled;

  const headerId = (panel: ExpansionPanel): string => `weave-expansion-${uid}-${panel.id}-header`;
  const regionId = (panel: ExpansionPanel): string => `weave-expansion-${uid}-${panel.id}-region`;

  const toggle = (panel: ExpansionPanel): void => {
    if (isPanelDisabled(panel)) return;
    const open: boolean = isOpen(panel);
    let next: string[];
    if (multi()) {
      next = open ? openIds().filter((id) => id !== panel.id) : [...openIds(), panel.id];
    } else {
      next = open ? [] : [panel.id];
    }
    if (props.value === undefined) uncontrolled.set(next);
    props.onChange?.(next);
  };

  const onHeaderKeydown = (event: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const el: Element | null = host();
    if (!el) return;
    const headers: HTMLElement[] = Array.from(
      el.querySelectorAll<HTMLElement>('.weave-expansion__header')
    ).filter((h) => h.getAttribute('aria-disabled') !== 'true');
    if (!headers.length) return;
    const current: number = headers.indexOf(document.activeElement as HTMLElement);
    let index: number;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = headers.length - 1;
    else if (event.key === 'ArrowDown') index = current < 0 ? 0 : (current + 1) % headers.length;
    else index = current < 0 ? headers.length - 1 : (current - 1 + headers.length) % headers.length;
    headers[index].focus();
    event.preventDefault();
  };

  // Bodies are arbitrary content — append them into their regions once the regions
  // are in the DOM (deferred to onMount, like Form Field's slotted-control wiring).
  onMount(() => {
    const el: Element | null = host();
    if (!el) return;
    const bodies: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-expansion__content');
    panels().forEach((panel, i) => {
      bodies[i]?.append(toNode(panel.body));
    });
  });

  return {
    host,
    panels,
    rootClass: (): string => (props.class ? `weave-expansion ${props.class}` : 'weave-expansion'),
    headingLevel: (): number => props.headingLevel ?? 3,
    headerId,
    regionId,
    expandedAttr: (panel): string => (isOpen(panel) ? 'true' : 'false'),
    openAttr: (panel): string | undefined => (isOpen(panel) ? 'true' : undefined),
    hiddenAttr: (panel): string | undefined => (isOpen(panel) ? undefined : 'true'),
    disabledAttr: (panel): string | undefined => (isPanelDisabled(panel) ? 'true' : undefined),
    isClosed: (panel): boolean => !isOpen(panel),
    toggle,
    onHeaderKeydown,
  };
}
