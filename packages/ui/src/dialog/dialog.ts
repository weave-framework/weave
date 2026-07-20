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
import { globalPosition } from '../cdk/index.js';
import { openModal, toLength, type ModalContent, type ModalRef } from './modal-core.js';

/**
 * Dialog region content — a DOM node, a plain string, a `() => Node` factory, or a
 * `[Component, props?]` tuple that is mounted with an owner and disposed on close (use the
 * {@link component} helper for a readable call site).
 */
export type DialogContent = ModalContent;

// A live weave component can fill any region: `content: component(SeasonEditor, { season })`, or the
// bare tuple `[SeasonEditor, { season }]`. openDialog mounts it under an owner and disposes it on close.
export { component } from './modal-core.js';
export type { ComponentContent } from './modal-core.js';

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

export type DialogRef = ModalRef;

/** Open a modal dialog. Returns a {@link DialogRef}. */
export function openDialog(options: DialogOptions): DialogRef {
  return openModal({
    block: 'weave-dialog',
    positionStrategy: globalPosition(), // centered
    content: options.content,
    header: options.header,
    title: options.title,
    actions: options.actions,
    role: options.role,
    dismissable: options.dismissable,
    onClose: options.onClose,
    // Per-dialog dimensions (inline; the CSS viewport max still constrains them).
    onPanel: (panel: HTMLElement): void => {
      if (options.width != null) panel.style.width = toLength(options.width);
      if (options.height != null) panel.style.height = toLength(options.height);
    },
  });
}
