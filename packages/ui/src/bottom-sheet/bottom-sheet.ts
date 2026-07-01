/**
 * Bottom Sheet — a modal panel docked to the bottom edge, opened imperatively:
 *
 *   const ref = openBottomSheet({ title: 'Share', content: listNode });
 *   ref.afterClosed().then(…);
 *
 * Same modal machinery as Dialog (CDK overlay + dimming backdrop + `blockScroll` +
 * focus-trap/restore + Esc/backdrop close + the three regions header/content/actions),
 * but full-width and anchored to the bottom (`globalPosition({ bottom })`), with top-only
 * corner radius and a slide-up entrance. The panel never exceeds the viewport; the content
 * region scrolls. The visual is `bottom-sheet.styles()` (the `--weave-bottom-sheet-*`
 * republic). Zero-dep.
 *
 * Deferred (noted): drag-to-dismiss (needs U4 drag&drop) and a wide-viewport center-dock —
 * a handle + Esc/backdrop close is enough for U3.
 */
import { globalPosition } from '../cdk/index.js';
import { openModal, type ModalContent, type ModalRef } from '../dialog/modal-core.js';

export type BottomSheetContent = ModalContent;

export interface BottomSheetOptions {
  /** The body — required, always shown, scrolls vertically when tall. */
  content: BottomSheetContent;
  /** Optional header. `header` node wins over the `title` string. */
  header?: BottomSheetContent;
  title?: string;
  /** Optional footer button area. */
  actions?: BottomSheetContent;
  /** Esc + backdrop-click close. Default true. */
  dismissable?: boolean;
  /** Called when the sheet closes, with the `close(result)` value. */
  onClose?: (result?: unknown) => void;
}

export type BottomSheetRef = ModalRef;

/** Open a bottom sheet. Returns a {@link BottomSheetRef}. */
export function openBottomSheet(options: BottomSheetOptions): BottomSheetRef {
  return openModal({
    block: 'weave-bottom-sheet',
    // Full-width, docked to the bottom edge (not centered).
    positionStrategy: globalPosition({
      centerHorizontally: false,
      centerVertically: false,
      left: '0',
      right: '0',
      bottom: '0',
    }),
    content: options.content,
    header: options.header,
    title: options.title,
    actions: options.actions,
    dismissable: options.dismissable,
    onClose: options.onClose,
  });
}
