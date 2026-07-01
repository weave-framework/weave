/**
 * Modal core — the shared behavior behind `openDialog` (centered) and `openBottomSheet`
 * (bottom-docked). Builds a three-region modal panel (`__header` optional · `__content`
 * always, scrolls · `__actions` optional) in a CDK overlay with a dimming backdrop,
 * `blockScroll`, a focus-trap that returns focus to the opener on close, and Esc/backdrop
 * dismissal. The BEM block (`weave-dialog` / `weave-bottom-sheet`) and the position strategy
 * are supplied by the caller. Internal — `dialog.ts` / `bottom-sheet.ts` are the surfaces.
 * Zero-dep.
 */
import {
  createOverlay,
  blockScroll,
  focusTrap,
  type OverlayRef,
  type FocusTrap,
  type PositionStrategy,
} from '../cdk/index.js';

/** Modal region content — a DOM node, a plain string, or a factory returning a node. */
export type ModalContent = Node | string | (() => Node);

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

function toNode(content: ModalContent): Node {
  if (typeof content === 'function') return content();
  if (typeof content === 'string') return document.createTextNode(content);
  return content;
}

/** Open a modal panel. Returns a {@link ModalRef}. */
export function openModal(config: ModalConfig): ModalRef {
  const id: number = ++_seq;
  const block: string = config.block;
  const dismissable: boolean = config.dismissable !== false;

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
    header.append(toNode(headerContent));
    panel.appendChild(header);
    panel.setAttribute('aria-labelledby', header.id);
  }

  // Content (mandatory) — the scrolling region.
  const content: HTMLElement = document.createElement('div');
  content.className = `${block}__content`;
  content.id = `${block}-content-${id}`;
  content.append(toNode(config.content));
  panel.appendChild(content);
  panel.setAttribute('aria-describedby', content.id);

  // Actions (optional).
  if (config.actions != null) {
    const actions: HTMLElement = document.createElement('div');
    actions.className = `${block}__actions`;
    actions.append(toNode(config.actions));
    panel.appendChild(actions);
  }

  config.onPanel?.(panel);

  const ref: OverlayRef = createOverlay({
    hasBackdrop: true,
    positionStrategy: config.positionStrategy,
    scrollStrategy: blockScroll,
  });
  const trap: FocusTrap = focusTrap(panel, { restoreFocus: true });

  let closed: boolean = false;
  let result: unknown = undefined;
  const resolvers: Array<(r: unknown) => void> = [];

  function close(r?: unknown): void {
    if (closed) return;
    closed = true;
    result = r;
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
