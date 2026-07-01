/**
 * Tooltip — a hint bubble, applied as a Weave `use:` action to any host:
 *
 *   <button use:tooltip={{ 'Save changes' }}>Save</button>
 *   <span use:tooltip={{ { text: 'Copied', position: 'bottom' } }}>…</span>
 *
 * Opens on hover (after a short delay) AND on keyboard focus (immediately, so it's
 * accessible), closes on leave / blur / Escape. The panel is a CDK overlay positioned
 * against the host with `connectedPosition` (preferred side, flips on overflow); no
 * backdrop, no focus management (a tooltip is never focused). Follows the WAI-ARIA
 * tooltip pattern: the panel is `role=tooltip` and the host gets `aria-describedby`
 * pointing at it while shown, so the description flows to the trigger. Zero-dep.
 *
 * The visual is driven by `tooltip.styles()` (its own `--weave-tooltip-*` republic);
 * this file is only the behavior. Rich/interactive tooltips (a Popover) are out of scope.
 */
import { createOverlay, connectedPosition, type OverlayRef, type PositionName } from '../cdk/index.js';

export interface TooltipOptions {
  /** The hint text (plain string — a tooltip is non-interactive). */
  text: string;
  /** Preferred side; flips to the opposite on overflow. Default `'top'`. */
  position?: PositionName;
  /** Delay (ms) before a hover shows the tooltip. Focus shows with no delay. Default 150. */
  delay?: number;
  /** Suppress the tooltip without detaching the action. */
  disabled?: boolean;
}

let _idSeq: number = 0;

/** Weave `use:` action: `(el, text | options) => cleanup`. */
export function tooltip(host: HTMLElement, options: string | TooltipOptions): () => void {
  const opts: TooltipOptions = typeof options === 'string' ? { text: options } : options;
  const id: string = `weave-tooltip-${++_idSeq}`;
  let ref: OverlayRef | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let shown: boolean = false;

  function ensureRef(): OverlayRef {
    if (ref) return ref;
    ref = createOverlay({
      positionStrategy: connectedPosition(host, { positions: fallbacks(opts.position ?? 'top'), offset: 6 }),
    });
    // A tooltip never captures the pointer (it must not block hover on the host).
    ref.overlayElement.style.pointerEvents = 'none';
    return ref;
  }

  function show(): void {
    if (opts.disabled || shown || !opts.text) return;
    const panel: HTMLElement = document.createElement('div');
    panel.className = 'weave-tooltip';
    panel.setAttribute('role', 'tooltip');
    panel.id = id;
    panel.textContent = opts.text;
    ensureRef().attach(panel);
    host.setAttribute('aria-describedby', id);
    shown = true;
  }

  function hide(): void {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (!shown) return;
    ref?.detach();
    host.removeAttribute('aria-describedby');
    shown = false;
  }

  function scheduleShow(): void {
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = setTimeout((): void => {
      showTimer = null;
      show();
    }, opts.delay ?? 150);
  }

  const onEnter = (): void => scheduleShow();
  const onLeave = (): void => hide();
  const onFocusIn = (): void => show(); // keyboard focus: show immediately (no hover delay)
  const onFocusOut = (): void => hide();
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hide();
  };

  host.addEventListener('mouseenter', onEnter);
  host.addEventListener('mouseleave', onLeave);
  host.addEventListener('focusin', onFocusIn);
  host.addEventListener('focusout', onFocusOut);
  host.addEventListener('keydown', onKeydown);

  return (): void => {
    hide();
    host.removeEventListener('mouseenter', onEnter);
    host.removeEventListener('mouseleave', onLeave);
    host.removeEventListener('focusin', onFocusIn);
    host.removeEventListener('focusout', onFocusOut);
    host.removeEventListener('keydown', onKeydown);
    ref?.dispose();
    ref = null;
  };
}

// Preferred side + its opposite as the flip fallback (the CDK positioner does the rest).
function fallbacks(preferred: PositionName): PositionName[] {
  const opposite: Record<PositionName, PositionName> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
    'top-start': 'bottom-start',
    'bottom-start': 'top-start',
    'top-end': 'bottom-end',
    'bottom-end': 'top-end',
    'left-start': 'right-start',
    'right-start': 'left-start',
    'left-end': 'right-end',
    'right-end': 'left-end',
  };
  return [preferred, opposite[preferred]];
}
