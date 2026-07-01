/**
 * Overlay — the controller every floating surface sits on (menu, tooltip, dialog,
 * select panel, snackbar). Headless: it owns a panel host in a top-level container,
 * an optional backdrop, z-index stacking, and disposal — the consumer supplies the
 * content and (via a position strategy) where it goes. Built on {@link portal}.
 *
 * Stacking is a **managed container + monotonic z-index** (deterministic + testable);
 * the public API here is independent of that choice, so a future switch to the native
 * top-layer / Popover API is internal. Functional layout is applied as inline styles
 * (position/inset/pointer-events/z-index) so the CDK ships **no stylesheet** — theming
 * is the styled component's job, not the overlay's.
 *
 * Zero-dep, signal-native. RTL-aware once a connected position strategy consumes bidi.
 */

import { signal, onDispose, type Signal } from '@weave-framework/runtime';
import { portal, type PortalHandle } from './portal.js';
import type { ScrollStrategy, ScrollStrategyFactory } from './scroll.js';

/** Base z-index for the overlay layer; each attach takes the next two slots (backdrop, panel). */
const Z_BASE: number = 1000;
let zCounter: number = 0;

/** A strategy that positions the panel element. The connected (flip/shift) strategy lands in `positioning.ts`. */
export interface PositionStrategy {
  /** Position `overlayElement` (already attached). Called on attach + `updatePosition()`. */
  apply(overlayElement: HTMLElement): void;
  /** Optional teardown (detach observers/listeners). */
  dispose?(): void;
}

export interface GlobalPositionConfig {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  /** Center horizontally in the viewport (overrides left/right). Default true. */
  centerHorizontally?: boolean;
  /** Center vertically in the viewport (overrides top/bottom). Default true. */
  centerVertically?: boolean;
}

/**
 * A viewport-relative position strategy (centered by default) — the analogue of
 * Material's `GlobalPositionStrategy`. For anchored dropdowns, use the connected
 * strategy from `positioning.ts` instead.
 */
export function globalPosition(config: GlobalPositionConfig = {}): PositionStrategy {
  const cfg: GlobalPositionConfig = { centerHorizontally: true, centerVertically: true, ...config };
  return {
    apply(el: HTMLElement): void {
      el.style.position = 'absolute';
      const tx: string = cfg.centerHorizontally ? '-50%' : '0';
      const ty: string = cfg.centerVertically ? '-50%' : '0';
      el.style.transform = cfg.centerHorizontally || cfg.centerVertically ? `translate(${tx}, ${ty})` : '';
      if (cfg.centerHorizontally) {
        el.style.left = '50%';
        el.style.right = '';
      } else {
        el.style.left = cfg.left ?? '';
        el.style.right = cfg.right ?? '';
      }
      if (cfg.centerVertically) {
        el.style.top = '50%';
        el.style.bottom = '';
      } else {
        el.style.top = cfg.top ?? '';
        el.style.bottom = cfg.bottom ?? '';
      }
    },
  };
}

export interface OverlayConfig {
  /** Render a dimming/click-catching backdrop behind the panel. Default false. */
  hasBackdrop?: boolean;
  /** Class(es) added to the backdrop element. */
  backdropClass?: string | string[];
  /** Class(es) added to the panel (overlay) element. */
  panelClass?: string | string[];
  /** How to position the panel. Default: centered {@link globalPosition}. */
  positionStrategy?: PositionStrategy;
  /** How the overlay reacts to scroll (reposition/close/block/noop). Default: noop. */
  scrollStrategy?: ScrollStrategyFactory;
}

export interface OverlayRef {
  /** The panel host — put your content here (attach does it for you). */
  readonly overlayElement: HTMLElement;
  /** The backdrop element, if `hasBackdrop`. */
  readonly backdropElement: HTMLElement | null;
  /** Attach content into the panel and insert it (+ backdrop) into the container. Returns the panel. */
  attach(content: Node | (() => Node)): HTMLElement;
  /** Remove the panel + backdrop from the DOM (reusable — you can `attach` again). */
  detach(): void;
  /** Detach permanently and release listeners/strategy. Further `attach` throws. */
  dispose(): void;
  /** Whether the overlay is currently attached. Reactive. */
  attached(): boolean;
  /** Subscribe to backdrop clicks. Returns an unsubscribe. No-op without a backdrop. */
  onBackdropClick(handler: (event: MouseEvent) => void): () => void;
  /** Re-run the position strategy (after content/size/scroll changes). */
  updatePosition(): void;
}

let _container: HTMLElement | null = null;

/** The shared, lazily-created overlay container appended to `<body>` (one per document). */
export function overlayContainer(): HTMLElement {
  if (_container && _container.isConnected) return _container;
  const el: HTMLElement = document.createElement('div');
  el.className = 'weave-overlay-container';
  // Functional layout: cover the viewport but let page clicks through; panels opt back in.
  el.style.cssText = 'position:fixed;inset:0;z-index:' + Z_BASE + ';pointer-events:none;';
  document.body.appendChild(el);
  _container = el;
  return el;
}

function addClasses(el: HTMLElement, classes?: string | string[]): void {
  if (!classes) return;
  for (const c of Array.isArray(classes) ? classes : [classes]) if (c) el.classList.add(c);
}

/** Create an overlay controller. Call {@link OverlayRef.attach} to show content. */
export function createOverlay(config: OverlayConfig = {}): OverlayRef {
  const strategy: PositionStrategy = config.positionStrategy ?? globalPosition();

  const overlayElement: HTMLElement = document.createElement('div');
  overlayElement.className = 'weave-overlay';
  overlayElement.style.cssText = 'position:absolute;pointer-events:auto;';
  addClasses(overlayElement, config.panelClass);

  let backdropElement: HTMLElement | null = null;
  const backdropHandlers: Set<(event: MouseEvent) => void> = new Set<(event: MouseEvent) => void>();
  if (config.hasBackdrop) {
    backdropElement = document.createElement('div');
    backdropElement.className = 'weave-overlay-backdrop';
    backdropElement.style.cssText = 'position:fixed;inset:0;pointer-events:auto;';
    addClasses(backdropElement, config.backdropClass);
    backdropElement.addEventListener('click', (e: MouseEvent) => {
      for (const h of [...backdropHandlers]) h(e);
    });
  }

  const _attached: Signal<boolean> = signal<boolean>(false);
  let panelPortal: PortalHandle | null = null;
  let backdropPortal: PortalHandle | null = null;
  let scroll: ScrollStrategy | null = null;
  let disposed: boolean = false;

  function attach(content: Node | (() => Node)): HTMLElement {
    if (disposed) throw new Error('weave cdk overlay: cannot attach a disposed overlay');
    if (_attached()) detach();
    const container: HTMLElement = overlayContainer();

    // Backdrop first (below), then the panel — each takes the next z-index slot.
    if (backdropElement) {
      backdropElement.style.zIndex = String(Z_BASE + ++zCounter);
      backdropPortal = portal(backdropElement, { container });
    }
    overlayElement.style.zIndex = String(Z_BASE + ++zCounter);

    overlayElement.textContent = '';
    overlayElement.append(typeof content === 'function' ? content() : content);
    panelPortal = portal(overlayElement, { container });

    strategy.apply(overlayElement);
    _attached.set(true);
    scroll?.enable();
    return overlayElement;
  }

  function detach(): void {
    scroll?.disable();
    panelPortal?.detach();
    backdropPortal?.detach();
    panelPortal = backdropPortal = null;
    overlayElement.textContent = '';
    _attached.set(false);
  }

  function dispose(): void {
    if (disposed) return;
    detach();
    strategy.dispose?.();
    backdropHandlers.clear();
    disposed = true;
  }

  // Tie disposal to the surrounding owner scope (no-op outside one).
  onDispose(dispose);

  const ref: OverlayRef = {
    overlayElement,
    backdropElement,
    attach,
    detach,
    dispose,
    attached: () => _attached(),
    onBackdropClick(handler: (event: MouseEvent) => void): () => void {
      backdropHandlers.add(handler);
      return () => backdropHandlers.delete(handler);
    },
    updatePosition(): void {
      if (_attached()) strategy.apply(overlayElement);
    },
  };

  // The scroll strategy needs the ref; build it now, before any attach happens.
  scroll = config.scrollStrategy ? config.scrollStrategy(ref) : null;
  return ref;
}
