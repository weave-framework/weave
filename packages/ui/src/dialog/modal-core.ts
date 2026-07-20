/**
 * Modal core — the shared behavior behind `openDialog` (centered) and `openBottomSheet`
 * (bottom-docked). Builds a three-region modal panel (`__header` optional · `__content`
 * always, scrolls · `__actions` optional) in a CDK overlay with a dimming backdrop,
 * `blockScroll`, a focus-trap that returns focus to the opener on close, and Esc/backdrop
 * dismissal. The BEM block (`weave-dialog` / `weave-bottom-sheet`) and the position strategy
 * are supplied by the caller. Internal — `dialog.ts` / `bottom-sheet.ts` are the surfaces.
 * Zero-dep.
 */
import { mountComponent, type Component } from '@weave-framework/runtime/dom';
import {
  createOverlay,
  blockScroll,
  focusTrap,
  type OverlayRef,
  type FocusTrap,
  type PositionStrategy,
} from '../cdk/index.js';

/**
 * A weave component to mount into a region, as `[Component, props?]`. Distinct from a bare
 * `() => Node` factory: the tuple is mounted **under its own owner** (so its `onMount`, `effect`s
 * and `onDispose` run) and torn down when the modal closes. A factory is still called bare and left
 * to the caller — a component needs a lifecycle a factory does not.
 */
export type ComponentContent = readonly [Component, Record<string, unknown>?];

/**
 * Modal region content:
 *  - a **DOM node** or **string** — inserted as-is;
 *  - a **`() => Node` factory** — called once, bare (no owner);
 *  - a **`[Component, props?]` tuple** — mounted with an owner and disposed on close.
 */
export type ModalContent = Node | string | (() => Node) | ComponentContent;

/**
 * Sugar for the tuple, so a call site reads `content: component(SeasonEditor, { season })` instead
 * of a bare array. Purely a typed pass-through — the tuple form works without it.
 */
export function component(comp: Component, props?: Record<string, unknown>): ComponentContent {
  return [comp, props];
}

/** A `[Component, props?]` tuple, told apart from a Node/string/factory by being an array. */
function isComponentContent(content: ModalContent): content is ComponentContent {
  return Array.isArray(content);
}

export interface ModalConfig {
  /** BEM block, e.g. `'weave-dialog'` — parts become `<block>__header/content/actions`. */
  block: string;
  /** Where the panel sits (centered for dialog, bottom-docked for a sheet). */
  positionStrategy: PositionStrategy;
  /** The body — required, always shown, scrolls vertically. */
  content: ModalContent;
  /** Optional header. `header` node wins over the `title` string. */
  header?: ModalContent;
  title?: string;
  /** Optional footer button area. */
  actions?: ModalContent;
  /** `'dialog'` (default) or `'alertdialog'`. */
  role?: 'dialog' | 'alertdialog';
  /** Esc + backdrop-click close. Default true. */
  dismissable?: boolean;
  onClose?: (result?: unknown) => void;
  /** Hook to tweak the panel after its regions are built (e.g. inline width/height). */
  onPanel?: (panel: HTMLElement) => void;
}

export interface ModalRef {
  readonly element: HTMLElement;
  close(result?: unknown): void;
  afterClosed(): Promise<unknown>;
}

let _seq: number = 0;

/**
 * Fill `host` with `content`, registering any teardown on `disposers`. A component tuple is mounted
 * into the host under its own owner (via {@link mountComponent}) and its unmount pushed to
 * `disposers`; everything else is appended as a plain node, exactly as before.
 */
function fillRegion(host: HTMLElement, content: ModalContent, disposers: Array<() => void>): void {
  if (isComponentContent(content)) {
    disposers.push(mountComponent(content[0], host, content[1]));
    return;
  }
  if (typeof content === 'function') {
    host.append(content());
    return;
  }
  host.append(typeof content === 'string' ? document.createTextNode(content) : content);
}

/** Open a modal panel. Returns a {@link ModalRef}. */
export function openModal(config: ModalConfig): ModalRef {
  const id: number = ++_seq;
  const block: string = config.block;
  const dismissable: boolean = config.dismissable !== false;

  // Teardown for any component region mounted below — run on close, before the overlay is gone.
  const disposers: Array<() => void> = [];

  const panel: HTMLElement = document.createElement('div');
  panel.className = block;
  panel.setAttribute('role', config.role ?? 'dialog');
  panel.setAttribute('aria-modal', 'true');

  // Header (optional) — a `header` node wins over the `title` string convenience.
  const headerContent: ModalContent | null = config.header ?? config.title ?? null;
  if (headerContent != null) {
    const header: HTMLElement = document.createElement('div');
    header.className = `${block}__header`;
    header.id = `${block}-title-${id}`;
    fillRegion(header, headerContent, disposers);
    panel.appendChild(header);
    panel.setAttribute('aria-labelledby', header.id);
  }

  // Content (mandatory) — the scrolling region.
  const content: HTMLElement = document.createElement('div');
  content.className = `${block}__content`;
  content.id = `${block}-content-${id}`;
  fillRegion(content, config.content, disposers);
  panel.appendChild(content);
  panel.setAttribute('aria-describedby', content.id);

  // Actions (optional).
  if (config.actions != null) {
    const actions: HTMLElement = document.createElement('div');
    actions.className = `${block}__actions`;
    fillRegion(actions, config.actions, disposers);
    panel.appendChild(actions);
  }

  config.onPanel?.(panel);

  const ref: OverlayRef = createOverlay({
    hasBackdrop: true,
    positionStrategy: config.positionStrategy,
    scrollStrategy: blockScroll,
  });
  // Modal: shield the background (inert + aria-hidden) while open; keep the backdrop clickable.
  const trap: FocusTrap = focusTrap(panel, {
    restoreFocus: true,
    inertBackground: true,
    inertIgnore: ref.backdropElement,
  });

  let closed: boolean = false;
  let result: unknown = undefined;
  const resolvers: Array<(r: unknown) => void> = [];

  function close(r?: unknown): void {
    if (closed) return;
    closed = true;
    result = r;
    // Dispose mounted component regions first — stop their effects and remove their nodes while the
    // panel is still attached — then tear down the overlay.
    for (const dispose of disposers) dispose();
    trap.deactivate(); // restores focus to the opener
    ref.dispose();
    config.onClose?.(r);
    for (const resolve of resolvers) resolve(r);
  }

  if (dismissable) {
    ref.onBackdropClick(() => close());
    panel.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
  }

  ref.attach(panel);
  trap.activate(); // moves focus into the panel

  return {
    element: panel,
    close,
    afterClosed(): Promise<unknown> {
      if (closed) return Promise.resolve(result);
      return new Promise<unknown>((resolve) => resolvers.push(resolve));
    },
  };
}

/** number → px; string passes through. Shared by dialog/bottom-sheet dimension options. */
export function toLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}
