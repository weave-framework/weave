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
 * Drag-to-dismiss (U4, via the CDK `draggable`): a top grab-handle drags the sheet down;
 * releasing past a threshold closes it, else it snaps back. Deferred (noted): wide-viewport
 * center-dock.
 */
import { globalPosition, draggable, type DraggableRef } from '../cdk/index.js';
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
  /** Show a top grab-handle and let a downward drag dismiss the sheet. Default true. */
  dragToDismiss?: boolean;
  /** Called when the sheet closes, with the `close(result)` value. */
  onClose?: (result?: unknown) => void;
}

export type BottomSheetRef = ModalRef;

/** Open a bottom sheet. Returns a {@link BottomSheetRef}. */
export function openBottomSheet(options: BottomSheetOptions): BottomSheetRef {
  const useDrag: boolean = options.dragToDismiss !== false;
  const ref: BottomSheetRef = openModal({
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
    onPanel: (panel: HTMLElement): void => {
      if (!useDrag) return;
      const handle: HTMLElement = document.createElement('div');
      handle.className = 'weave-bottom-sheet__handle';
      handle.setAttribute('aria-hidden', 'true');
      panel.insertBefore(handle, panel.firstChild);
    },
  });
  if (useDrag) attachDragDismiss(ref);
  return ref;
}

/** Wire the top handle to a downward drag: past a threshold → close, else snap back. */
function attachDragDismiss(ref: BottomSheetRef): void {
  const panel: HTMLElement = ref.element;
  const handle: HTMLElement | null = panel.querySelector('.weave-bottom-sheet__handle');
  if (!handle) return;
  let height: number = 0;
  const drag: DraggableRef = draggable(handle, {
    axis: 'y',
    onStart: (): void => {
      height = panel.offsetHeight;
      panel.style.transition = 'none';
    },
    onMove: ({ dy }): void => {
      if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
    },
    onEnd: ({ dy }): void => {
      const threshold: number = Math.max(80, height * 0.3);
      if (dy > threshold) {
        drag.destroy();
        ref.close();
        return;
      }
      // Snap back with a short ease.
      panel.style.transition = 'transform 0.2s ease';
      panel.style.transform = '';
    },
  });
}
