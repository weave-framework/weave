/**
 * Dialog — a modal, opened imperatively:
 *
 *   const ref = openDialog({
 *     title: 'Delete item?',
 *     content: 'This can\'t be undone.',
 *     actions: myButtonsNode,          // optional
 *     role: 'alertdialog',
 *   });
 *   ref.afterClosed().then((result) => …);
 *
 * A centered CDK-overlay panel with a dimming backdrop, `blockScroll` behind it, and a
 * focus-trap that returns focus to the opener on close. WAI-ARIA dialog pattern:
 * `role=dialog` (or `alertdialog`) + `aria-modal` + `aria-labelledby`(header)/
 * `aria-describedby`(content); Esc + backdrop close (unless `dismissable:false`).
 *
 * THREE regions, stacked: **header** (optional — only if `header`/`title` given),
 * **content** (always; scrolls vertically on overflow), **actions** (optional — only if
 * `actions` given). Header + actions are fixed; only the content scrolls. The panel never
 * exceeds the viewport (CSS `max-width`/`max-height`); per-dialog `width`/`height` set the
 * preferred size inline. The visual is `dialog.styles()` (the `--weave-dialog-*` republic).
 * Zero-dep.
 */
import { createOverlay, globalPosition, blockScroll, focusTrap, type OverlayRef, type FocusTrap } from '../cdk/index.js';

/** Dialog region content — a DOM node, a plain string, or a factory returning a node. */
export type DialogContent = Node | string | (() => Node);

export interface DialogOptions {
  /** The body — **required**, always shown, scrolls vertically when tall. */
  content: DialogContent;
  /** Optional header content. Omitted → no header region (and no top divider). */
  header?: DialogContent;
  /** Convenience: a text header + wires `aria-labelledby`. Ignored if `header` is given. */
  title?: string;
  /** Optional footer button area. Omitted → no actions region. */
  actions?: DialogContent;
  /** Preferred width — number → px. Clamped by the viewport. Default token 560px. */
  width?: number | string;
  /** Preferred height — number → px. Clamped by the viewport. Default: auto (fits content). */
  height?: number | string;
  /** `'dialog'` (default) or `'alertdialog'` (confirmations / destructive prompts). */
  role?: 'dialog' | 'alertdialog';
  /** Esc + backdrop-click close. Default true. */
  dismissable?: boolean;
  /** Called when the dialog closes, with the `close(result)` value. */
  onClose?: (result?: unknown) => void;
}

export interface DialogRef {
  /** The dialog panel element. */
  readonly element: HTMLElement;
  /** Close the dialog, optionally with a result (resolves `afterClosed`). */
  close(result?: unknown): void;
  /** Resolves with the close result once the dialog has closed. */
  afterClosed(): Promise<unknown>;
}

let _seq: number = 0;

function toNode(content: DialogContent): Node {
  if (typeof content === 'function') return content();
  if (typeof content === 'string') return document.createTextNode(content);
  return content;
}

function toLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/** Open a modal dialog. Returns a {@link DialogRef}. */
export function openDialog(options: DialogOptions): DialogRef {
  const id: number = ++_seq;
  const dismissable: boolean = options.dismissable !== false;

  const panel: HTMLElement = document.createElement('div');
  panel.className = 'weave-dialog';
  panel.setAttribute('role', options.role ?? 'dialog');
  panel.setAttribute('aria-modal', 'true');

  // Header (optional) — `header` node wins over the `title` string convenience.
  const headerContent: DialogContent | null = options.header ?? options.title ?? null;
  if (headerContent != null) {
    const header: HTMLElement = document.createElement('div');
    header.className = 'weave-dialog__header';
    header.id = `weave-dialog-title-${id}`;
    header.append(toNode(headerContent));
    panel.appendChild(header);
    panel.setAttribute('aria-labelledby', header.id);
  }

  // Content (mandatory) — the scrolling region.
  const content: HTMLElement = document.createElement('div');
  content.className = 'weave-dialog__content';
  content.id = `weave-dialog-content-${id}`;
  content.append(toNode(options.content));
  panel.appendChild(content);
  panel.setAttribute('aria-describedby', content.id);

  // Actions (optional).
  if (options.actions != null) {
    const actions: HTMLElement = document.createElement('div');
    actions.className = 'weave-dialog__actions';
    actions.append(toNode(options.actions));
    panel.appendChild(actions);
  }

  // Per-dialog dimensions (inline; the CSS viewport max still constrains them).
  if (options.width != null) panel.style.width = toLength(options.width);
  if (options.height != null) panel.style.height = toLength(options.height);

  const ref: OverlayRef = createOverlay({
    hasBackdrop: true,
    positionStrategy: globalPosition(), // centered
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
    options.onClose?.(r);
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
  trap.activate(); // moves focus into the dialog

  return {
    element: panel,
    close,
    afterClosed(): Promise<unknown> {
      if (closed) return Promise.resolve(result);
      return new Promise<unknown>((resolve) => resolvers.push(resolve));
    },
  };
}
