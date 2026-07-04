/**
 * Snackbar — a brief, non-blocking toast, shown imperatively:
 *
 *   snackbar('Saved.');
 *   snackbar('Item deleted', { action: { label: 'Undo', onAction: undo }, duration: 6000 });
 *
 * A bottom-anchored CDK-overlay bar (no backdrop — the page stays interactive), auto-
 * dismissed after `duration` (paused while hovered/focused), with an optional action button.
 * The message is announced to assistive tech via the CDK live-announcer (polite by default),
 * so screen-reader users hear it without focus moving. **One at a time** — concurrent calls
 * queue and show in turn. The visual is `snackbar.styles()` (the `--weave-snackbar-*`
 * republic). Zero-dep.
 */
import {
  createOverlay,
  globalPosition,
  noopScroll,
  announce,
  activeDirection,
  type OverlayRef,
  type GlobalPositionConfig,
} from '../cdk/index.js';

export interface SnackbarAction {
  label: string;
  onAction?: () => void;
}

export interface SnackbarOptions {
  /** An action button — `{ label, onAction }` or just a label string. */
  action?: SnackbarAction | string;
  /** Auto-dismiss delay (ms). Default 4000. `0` = stays until dismissed. */
  duration?: number;
  /** Screen-reader urgency. Default `'polite'`. */
  politeness?: 'polite' | 'assertive';
  /** Horizontal placement along the bottom edge. Default `'center'`. */
  position?: 'center' | 'start' | 'end';
}

export interface SnackbarRef {
  /** The bar element (exists as soon as `snackbar()` returns, even while queued). */
  readonly element: HTMLElement;
  /** Dismiss now (also removes it from the queue if not yet shown). */
  dismiss(): void;
  /** Resolves once this snackbar has been dismissed. */
  afterDismissed(): Promise<void>;
}

const DEFAULT_DURATION: number = 4000;

interface Entry {
  message: string;
  options: SnackbarOptions;
  bar: HTMLElement;
  resolvers: Array<() => void>;
  dismissed: boolean;
  ref: SnackbarRef;
}

interface Active {
  entry: Entry;
  overlay: OverlayRef;
  timer: ReturnType<typeof setTimeout> | null;
}

// Module-level "service" — one snackbar visible at a time, the rest queued.
let _current: Active | null = null;
const _queue: Entry[] = [];

function positionConfig(position: 'center' | 'start' | 'end' = 'center'): GlobalPositionConfig {
  // `start`/`end` are logical: in RTL, start is the right edge and end is the left.
  const cfg: GlobalPositionConfig = { centerHorizontally: false, centerVertically: false, bottom: '0' };
  const rtl: boolean = activeDirection() === 'rtl';
  if (position === 'start') {
    if (rtl) cfg.right = '0';
    else cfg.left = '0';
    return cfg;
  }
  if (position === 'end') {
    if (rtl) cfg.left = '0';
    else cfg.right = '0';
    return cfg;
  }
  return { centerHorizontally: true, centerVertically: false, bottom: '0' };
}

function buildBar(entry: Entry): HTMLElement {
  const bar: HTMLElement = document.createElement('div');
  bar.className = 'weave-snackbar';

  const message: HTMLElement = document.createElement('span');
  message.className = 'weave-snackbar__message';
  message.textContent = entry.message;
  bar.appendChild(message);

  const action: SnackbarAction | string | undefined = entry.options.action;
  if (action != null) {
    const label: string = typeof action === 'string' ? action : action.label;
    const onAction: (() => void) | undefined = typeof action === 'string' ? undefined : action.onAction;
    const button: HTMLButtonElement = document.createElement('button');
    button.type = 'button';
    button.className = 'weave-snackbar__action';
    button.textContent = label;
    button.addEventListener('click', () => {
      onAction?.();
      entry.ref.dismiss();
    });
    bar.appendChild(button);
  }
  return bar;
}

function clearTimer(): void {
  if (_current?.timer != null) {
    clearTimeout(_current.timer);
    _current.timer = null;
  }
}

function startTimer(): void {
  if (!_current) return;
  clearTimer();
  const duration: number = _current.entry.options.duration ?? DEFAULT_DURATION;
  if (duration > 0) {
    const entry: Entry = _current.entry;
    _current.timer = setTimeout(() => entry.ref.dismiss(), duration);
  }
}

function flush(): void {
  if (_current || _queue.length === 0) return;
  const entry: Entry = _queue.shift() as Entry;
  if (entry.dismissed) {
    flush();
    return;
  }
  const overlay: OverlayRef = createOverlay({
    positionStrategy: globalPosition(positionConfig(entry.options.position)),
    scrollStrategy: noopScroll,
  });
  overlay.attach(entry.bar);
  announce(entry.message, entry.options.politeness ?? 'polite');
  _current = { entry, overlay, timer: null };
  startTimer();
  // Pause the auto-dismiss while the user is hovering or has focused the bar (a11y).
  entry.bar.addEventListener('mouseenter', clearTimer);
  entry.bar.addEventListener('mouseleave', startTimer);
  entry.bar.addEventListener('focusin', clearTimer);
  entry.bar.addEventListener('focusout', startTimer);
}

function dismissEntry(entry: Entry): void {
  if (entry.dismissed) return;
  entry.dismissed = true;
  if (_current && _current.entry === entry) {
    clearTimer();
    _current.overlay.dispose();
    _current = null;
    for (const resolve of entry.resolvers) resolve();
    flush();
  } else {
    const index: number = _queue.indexOf(entry);
    if (index >= 0) _queue.splice(index, 1);
    for (const resolve of entry.resolvers) resolve();
  }
}

/** Show a snackbar. Returns a {@link SnackbarRef}. */
export function snackbar(message: string, options: SnackbarOptions = {}): SnackbarRef {
  const entry: Entry = {
    message,
    options,
    bar: null as unknown as HTMLElement,
    resolvers: [],
    dismissed: false,
    ref: null as unknown as SnackbarRef,
  };
  entry.ref = {
    get element(): HTMLElement {
      return entry.bar;
    },
    dismiss(): void {
      dismissEntry(entry);
    },
    afterDismissed(): Promise<void> {
      if (entry.dismissed) return Promise.resolve();
      return new Promise<void>((resolve) => entry.resolvers.push(resolve));
    },
  };
  entry.bar = buildBar(entry);
  _queue.push(entry);
  flush();
  return entry.ref;
}
